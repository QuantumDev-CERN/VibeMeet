import insightface
from insightface.app import FaceAnalysis
import numpy as np
import cv2
import os
import threading
import boto3
from botocore.config import Config
import onnxruntime

# (onnxruntime-gpu[cuda,cudnn]). Harmless on CPU-only installs.
onnxruntime.preload_dlls()

_app = None
_app_lock = threading.Lock()
_s3 = None
_s3_lock = threading.Lock()
# Embeddings only need detection + recognition. Loading landmark_2d_106 as well
# produced bit-identical embeddings in testing, so it is dropped to save time/RAM.
ALLOWED_MODULES = ['detection', 'recognition']

def _build_providers():
    if os.getenv('VIBEMEET_ML_DEVICE', 'cuda').lower() == 'cuda':
        cuda_opts = {
            'arena_extend_strategy': 'kSameAsRequested',
            'cudnn_conv_algo_search': 'HEURISTIC',
        }
        return [('CUDAExecutionProvider', cuda_opts)], True
    return ['CPUExecutionProvider'], False

def _session_kwargs():
    # ORT sizes its thread pool from the HOST's cores, not the container's CPU quota.
    # Set ORT_THREADS to the vCPU count you gave the container (unset = ORT default).
    threads = os.getenv('ORT_THREADS')
    if not threads:
        return {}
    so = onnxruntime.SessionOptions()
    so.intra_op_num_threads = int(threads)
    so.inter_op_num_threads = 1
    return {'sess_options': so}

def get_model():
    global _app
    if _app is None:
        with _app_lock:
            if _app is None:
                providers, use_cuda = _build_providers()
                _app = FaceAnalysis(
                    name='buffalo_l',
                    root=os.getenv('INSIGHTFACE_ROOT', '~/.insightface'),
                    providers=providers,
                    allowed_modules=ALLOWED_MODULES,
                    **_session_kwargs(),
                )
                det_size = int(os.getenv('VIBEMEET_DET_SIZE', '640'))
                _app.prepare(
                    ctx_id=(0 if use_cuda else -1),
                    det_size=(det_size, det_size),
                )
    return _app


def _get_s3_client():
    global _s3
    if _s3 is None:
        with _s3_lock:
            if _s3 is None:
                endpoint = os.getenv('S3_ENDPOINT')
                if not endpoint:
                    raise ValueError("S3_ENDPOINT is not set")
                force_path_style = os.getenv('S3_FORCE_PATH_STYLE', 'true').lower() != 'false'
                _s3 = boto3.client(
                    's3',
                    endpoint_url=endpoint,
                    region_name=os.getenv('S3_REGION', 'us-east-005'),
                    aws_access_key_id=os.getenv('S3_ACCESS_KEY_ID'),
                    aws_secret_access_key=os.getenv('S3_SECRET_ACCESS_KEY'),
                    config=Config(s3={'addressing_style': 'path' if force_path_style else 'auto'}),
                )
    return _s3


def download_img(storage_key: str) -> np.ndarray:
    bucket = os.getenv('S3_BUCKET')
    if not bucket:
        raise ValueError("S3_BUCKET is not set")
    response = _get_s3_client().get_object(Bucket=bucket, Key=storage_key)
    data = response['Body'].read()
    img_array = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError(f"Could not decode image from {storage_key}")
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