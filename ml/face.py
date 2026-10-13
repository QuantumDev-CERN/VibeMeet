import insightface
from insightface.app import FaceAnalysis
import numpy as np
import cv2
import requests
import os
import threading
import onnxruntime

# (onnxruntime-gpu[cuda,cudnn]). Harmless on CPU-only installs.
onnxruntime.preload_dlls()

_app = None
_app_lock = threading.Lock()
ALLOWED_MODULES = ['detection', 'landmark_2d_106', 'recognition']

def _build_providers():
    if os.getenv('VIBEMEET_ML_DEVICE', 'cuda').lower() == 'cuda':
        cuda_opts = {
            'arena_extend_strategy': 'kSameAsRequested',
            'cudnn_conv_algo_search': 'HEURISTIC',
        }
        return [('CUDAExecutionProvider', cuda_opts)], True
    return ['CPUExecutionProvider'], False

def get_model():
    global _app
    if _app is None:
        with _app_lock:
            if _app is None:
                providers, use_cuda = _build_providers()
                _app = FaceAnalysis(
                    name='buffalo_l',
                    providers=providers,
                    allowed_modules=ALLOWED_MODULES,
                )
                det_size = int(os.getenv('VIBEMEET_DET_SIZE', '640'))
                _app.prepare(
                    ctx_id=(0 if use_cuda else -1),
                    det_size=(det_size, det_size),
                )
    return _app


def download_img(url: str) -> np.ndarray:
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    img_array = np.frombuffer(response.content, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError(f"Could not decode image from {url}")
    return img


def extract_faces(img: np.ndarray, min_confidence: float = 0.5):
    model = get_model()
    faces = model.get(img)
    results = []
    for face in faces:
        if face.det_score < min_confidence:
            continue
        bbox = face.bbox.astype(int).tolist()  # [x1,y1,x2,y2]
        results.append({
            'embedding': face.normed_embedding.tolist(),
            'bbox': {
                'x1': bbox[0], 'y1': bbox[1],
                'x2': bbox[2], 'y2': bbox[3]
            },
            'det_score': float(face.det_score)
        })

    return results


def build_user_embedding(selfie_images: list[np.ndarray]) -> np.ndarray:
    model = get_model()
    embeddings = []
    for img in selfie_images:
        faces = model.get(img)
        if not faces:
            continue
        largest = max(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])
        )
        if largest.det_score > 0.7:
            embeddings.append(largest.normed_embedding)
    if not embeddings:
        raise ValueError("No Valid face detected in any selfie")
    avg = np.mean(embeddings, axis=0)
    avg = avg / np.linalg.norm(avg)
    return avg
