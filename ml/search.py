import psycopg2.extras
from db import get_connection
DET_SCORE_THRESHOLD = 0.7
SEARCH_LIMIT = 100

def store_face_embeddings(photo_id: str, thread_id: str, faces: list):
    print(f"Attempting to store {len(faces)} faces")
    if not faces:
        print("No faces to store, marking photo indexed with face_count=0")
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE photos SET indexed = true, face_count = 0 WHERE id = %s",
                    (photo_id,)
                )
            conn.commit()
        finally:
            conn.close()
        return

    conn = get_connection()
    try:
        with conn.cursor() as cur:
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
                        face['embedding'],
                        psycopg2.extras.Json(face['bbox']),
                        face['det_score']
                    )
                    for face in faces
                ]
            )
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
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_face_embeddings (user_id, embedding, active)
                VALUES (%s, %s, true)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    embedding = EXCLUDED.embedding,
                    active = true,
                    created_at = now()
                """,
                (user_id, embedding)
            )
        conn.commit()
    finally:
        conn.close()

def search_faces(user_id: str, thread_id: str, threshold: float = 0.45, limit: int = SEARCH_LIMIT):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT embedding FROM user_face_embeddings WHERE user_id = %s AND active = true",
                (user_id,)
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("User has no registered face embedding")
            user_embedding = row['embedding']
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
