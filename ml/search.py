import psycopg2.extras
from db import get_connection

# Minimum InsightFace detection confidence to include a face in search results.
# det_score is produced by the detection model, not the recognition model.
# Faces below this threshold are low quality — blurry, partial, side-on, reflections.
# 0.7 is conservative — keeps high quality detections, filters out noise.
DET_SCORE_THRESHOLD = 0.7

# Maximum number of face matches returned per search.
# Caps the pgvector scan result set — prevents unbounded responses at scale.
# At Coachella scale a thread could have 500k face embeddings — without a limit
# the query returns every match which Node then has to process and zip.
# 100 is generous — if you appear in 100 photos at one event you know about it.
SEARCH_LIMIT = 100

def store_face_embeddings(photo_id: str, thread_id: str, faces: list):
    print(f"Attempting to store {len(faces)} faces")
    """
    Bulk insert all face embeddings from a photo into pgvector.
    """
    if not faces:
        print("No faces to store, returning early")
        return
    
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # execute_values is much faster than looping individual inserts
            # especially when a photo has 20+ faces
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO face_embeddings 
                    (photo_id, thread_id, embedding, bbox, det_score)
                VALUES %s
                """,
                [
                    (
                        photo_id,
                        thread_id,
                        face['embedding'],   # pgvector accepts python lists
                        psycopg2.extras.Json(face['bbox']),
                        face['det_score']
                    )
                    for face in faces
                ]
            )
            
            # Mark the photo as processed
            cur.execute(
                """
                UPDATE photos 
                SET indexed = true, face_count = %s 
                WHERE id = %s
                """,
                (len(faces), photo_id)
            )
        conn.commit()
        print("Successfully stored faces")
    except Exception as e:
        print(f"DB ERROR: {e}")
        raise
    finally:
        conn.close()


def upsert_user_embedding(user_id: str, embedding: list):
    """
    Store or update user's identity vector.
    UPSERT = insert if not exists, update if exists.
    User might re-register their face with better selfies.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_face_embeddings (user_id, embedding)
                VALUES (%s, %s)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    embedding = EXCLUDED.embedding,
                    created_at = now()
                """,
                (user_id, embedding)
            )
        conn.commit()
    finally:
        conn.close()


def search_faces(user_id: str, thread_id: str, threshold: float = 0.45, limit: int = SEARCH_LIMIT):
    """
    Find all photos in a thread where the user's face appears.
    
    cosine distance = 1 - cosine similarity
    <=> operator in pgvector = cosine distance
    So: similarity = 1 - distance
    threshold 0.45 similarity = 0.55 distance

    Filters:
    - similarity > threshold     — only confident face matches
    - det_score > DET_SCORE_THRESHOLD — only high quality detections
      (filters out blurry faces, reflections, partial faces)
    - LIMIT — caps result set for scale
      (prevents unbounded scan at Coachella-scale threads)
    """
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            
            # First get the user's stored embedding
            cur.execute(
                "SELECT embedding FROM user_face_embeddings WHERE user_id = %s",
                (user_id,)
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("User has no registered face embedding")
            
            user_embedding = row['embedding']
            
            # Search for similar faces scoped to this thread.
            # Two filters working together:
            #   1. similarity > threshold — recognition quality
            #   2. det_score > DET_SCORE_THRESHOLD — detection quality
            # Both must pass — a high similarity match on a low quality detection
            # (reflection, blur) is still a bad match.
            # LIMIT caps the result set — top matches by similarity score.
            cur.execute(
                """
                SELECT 
                    photo_id,
                    bbox,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM face_embeddings
                WHERE 
                    thread_id = %s
                    AND 1 - (embedding <=> %s::vector) > %s
                    AND det_score > %s
                ORDER BY similarity DESC
                LIMIT %s
                """,
                (user_embedding, thread_id, user_embedding, threshold, DET_SCORE_THRESHOLD, limit)
            )
            
            results = cur.fetchall()
            return [dict(r) for r in results]
    finally:
        conn.close()
