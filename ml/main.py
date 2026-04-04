"""FastAPI application entrypoint placeholder."""
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.core import CORSMiddleware
from typing import List 
import numpy as np 
import cv2

from models import ProcessPhotoRequest, SearchRequest, SearchResponse, FaceResult
from face import extract_faces, build_user_embedding, download_img
from search import store_face_embeddings, search_faces, upsert_user_embedding

app = FastAPI()

#Only Node service calls this
app.add_middleware(
    CORSMiddleware,
    allow_origin=["https://localhost:3000"]
    allow_methods=["*"]
    allow_headers=["*"]
)

@app.get("/health")
def health():
    #Node Service pings this to check if ML service is up
    return {"status": "ok"}


@app.post("/process-photo")
def process_photo(req: ProcessPhotoRequest):
    """
    Called by Node after a photo is uploaded.
    Downloads photo, extracts faces, stores embeddings.
    This is async from the user's perspective — they don't wait for this.
    """

    try:
        img = download_img(req.image_url)
        faces = extract_faces(img)
        store_face_embeddings(req.photo_id, req.thread_id, faces)
        return {"success": True, "face_found": len(faces)}
    
    except Exception as e:
        #Dont crash the service on bad photo
        #Log and return error so node can mark the job as failed
        raise HTTPException(status_code=500, detail = str(e))

@app.post("/index-user")
async def index_user(
    user_id: str = Form(...)
    selfies: List[UploadFile] = File(...)
):
"""
    Called when user registers their face.
    Accepts multiple selfie files as multipart form data.
"""
if len(selfies) < 2:
    raise HTTPException(
        status_code = 400,
        detail = "Minimum 2 selfies required for reliable indexing"
    )

images = []
for selfie in selfies:
    contents = await selfie.read()
    img_array = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is not None:
        images.append(img)
    
try:
    embedding = build_user_embedding(images)
    upsert_user_embedding(user_id, embedding.tolist())
    return {"success": True, "selfies_used": len(images)}

except ValueError as e:
    raise HTTPException(status_code = 400, detail = str(e))

@app.post("/search", response_model = SearchResponse)
def search (req: SearchRequest):
    """
        Find all photos in a thread where the user appears.
        Returns photo_ids + similarity scores.
        Node then fetches full photo records and generates signed URLs.
    """
    try:
        results = search_faces(req.user_id, req.thread_id, req.threshold)
        return SearchResponse(
            matches=[
                FaceResult(
                    photo_id=r['photo_id'],
                    similarity=r['similarity'],
                    bbox=r['bbox']
                )
                for r in results
            ],
            total=len(results)
        )
    except ValueError as e:
        raise HTTPException(status_code = 400, detail = str(e))