"""Count faces in a local photo using VibeMeet's ML detector.

This is the exact detection step from the /process-photo pipeline
(ml/face.py :: extract_faces — buffalo_l, det_size 640, min det_score 0.5),
but with zero side effects: no DB writes, no API calls, no Docker.

Usage:
    cd ml
    uv run python count_faces.py /path/to/photo.jpg

Requires the GPU env (same one that runs your ml service). First run
downloads the buffalo_l model (~300MB) to ~/.insightface.
"""
import sys

import cv2

from face import extract_faces


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python count_faces.py /path/to/photo.jpg")
        raise SystemExit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"could not read image: {sys.argv[1]}")
        raise SystemExit(1)

    faces = extract_faces(img)  # min_confidence=0.5, same as the pipeline

    print(f"faces found: {len(faces)}")
    for i, f in enumerate(faces, start=1):
        b = f["bbox"]
        print(
            f"  face {i}: det_score={f['det_score']:.3f} "
            f"bbox=({b['x1']},{b['y1']})-({b['x2']},{b['y2']})"
        )


if __name__ == "__main__":
    main()
