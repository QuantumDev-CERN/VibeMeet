import hmac
import logging
import threading
from contextlib import asynccontextmanager
import numpy as np
import cv2
import os
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from typing import List
from models import ProcessPhotoRequest
from face import extract_faces, build_user_embedding, download_img, get_model
from search import store_face_embeddings, upsert_user_embedding

load_dotenv()
log = logging.getLogger("ml")
origins = os.getenv("FRONTEND_URLS", "http://localhost:3000").split(",")
ML_API_KEY = os.getenv("ML_API_KEY")
# Cap concurrent inference so a burst of uploads can't blow up RAM/CPU.
_slots = threading.BoundedSemaphore(int(os.getenv("ML_MAX_CONCURRENT", "1")))

def require_key(x_ml_key: str = Header(default="")):
    if not ML_API_KEY:
        return  # no key configured: local dev only
    if not hmac.compare_digest(x_ml_key.encode(), ML_API_KEY.encode()):
        raise HTTPException(status_code=401, detail="Invalid ML key")

@asynccontextmanager
async def lifespan(app: FastAPI):
    if not ML_API_KEY:
        log.warning("ML_API_KEY is not set: ML endpoints are UNAUTHENTICATED")
    get_model()  # load buffalo_l at boot so the first request doesn't pay for it
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/process-photo", dependencies=[Depends(require_key)])
def process_photo(req: ProcessPhotoRequest):
    try:
        with _slots:
            img = download_img(req.storage_key)
            faces = extract_faces(img)
        store_face_embeddings(req.photo_id, req.thread_id, faces)
        return {"success": True, "face_found": len(faces)}
    except Exception as e:
        raise HTTPException(status_code=500, detail = str(e))

def _embed_selfies(images):
    with _slots:
        return build_user_embedding(images)

@app.post("/index-user", dependencies=[Depends(require_key)])
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
        embedding = await run_in_threadpool(_embed_selfies, images)
        upsert_user_embedding(user_id, embedding.tolist())
        return {"success": True, "selfies_used": len(images)}
    except ValueError as e:
        raise HTTPException(status_code = 400, detail = str(e))