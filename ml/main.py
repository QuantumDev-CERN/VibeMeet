import numpy as np 
import cv2
import os
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List 
from models import ProcessPhotoRequest, SearchRequest, SearchResponse, FaceResult
from face import extract_faces, build_user_embedding, download_img
from search import store_face_embeddings, search_faces, upsert_user_embedding

load_dotenv()
origins = os.getenv("FRONTEND_URLS", "http://localhost:3000").split(",")
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/process-photo")
def process_photo(req: ProcessPhotoRequest):
    try:
        img = download_img(req.image_url)
        faces = extract_faces(img)
        store_face_embeddings(req.photo_id, req.thread_id, faces)
        return {"success": True, "face_found": len(faces)}
    except Exception as e:
        raise HTTPException(status_code=500, detail = str(e))

@app.post("/index-user")
async def index_user(
    user_id: str = Form(...),
    selfies: List[UploadFile] = File(..., description="Upload 2-5 selfie images")
):
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
def search(req: SearchRequest):
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
