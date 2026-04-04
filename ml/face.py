"""Face embedding and InsightFace integration placeholder."""
import insightface
from insightface.app import FaceAnalysis
import numpy as np 
import cv2
import requests
import os
#Model loads on service start instead of each request . Performance Optimization
_app=None

def get_model():
    global _app
    if _app is None:
        _app = FaceAnalysis(
            name='buffalo_1',
            #Provider is cpu as i dont have gpu 😭 , if you have gpu use  onxruntime-gpu
            providers=['CPUExectutionProvider']
        )
        #ctx_id=0 means use GPU , id=1 means cpu
        #det_size is the resolution detection size (640x640) but for bigger pic (1200x1200) in prod
        _app.prepare(ctx_id=1, det_size=(640x640))
    return _app


def download_img(url: str) -> np.ndarray:
    #Download image from R2 puts into np array 

    response = requests.get(url, timeout=30)
    response.raise_for_status()

    #Convert raw bytes -> numpy array -> decoded image
    #cv2.imdecode interprets it as an image file (handles JPEG ,PNG etc)
    img_array = np.frombuffer(response.content, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError(f"Could not decode image from {url}")
    return img 

def extract_faces(img: np.ndarray , min_confidence: float = 0.5):
    #Runs Recog+detect on img , returns list of dicts , one per face detected
    #[{Facepoints},{..},{...}]

    model = get_model()
    faces = model.get(img)

    results = []
    for face in faces:
        #Filter low confidence detection
        # shadows , reflection , posters can trigger false detection
        if face.det_score < min_confidence:
            continue
        
        bbox = face.bbox.astype(int).tolist() # [z1,z4,y4,x2]

        results.append({
            #normed_embedding is already L2-normalized , its magnitude is 1.0
            #required for cosine similarity to work

            'embedding' : face.normed_embedding.tolist(),
            'bbox': {
                'x1': bbox[0] , 'y1': bbox[1],
                'x2': bbox[2] , 'y2': bbox[3]
            },
            'det_score': float(face.det_score)
        })

    return results

def build_user_embedding(selfie_images: list[np.ndarray]) -> np.ndarray:
    #Take multiple selfie  under diff condition extract face from each return a single avergaged identity vector

    model=get_model()
    embeddings = []

    for img in selfie_images:
        faces = model.get(img)

        if not faces:
            #No face detectted in this selfie, skip it
            continue
        #Take the largest face if multiple face detected
        #(user might be holding phone in crowd)
        largest = max (faces , key=lambda f:( (f.bbox[2]-f.bbox[0]) * (f.bbox[3] - f.bbox[1]) )
                )
        
        #Only use high confidence selfie detections
        if largest.det_score > 0.7 :
            embeddings.append(largest.normed_embedding)
    if not embeddings:
        raise ValueError("No Valid face detected in any selfie")

    # Average all the embeddings
    avg = np.mean(embeddings, axis=0)

    #Renormalize it as averaging makes its magnitude <1.0 
    avg = avg / np.lialg.norm(avg)


    return avg