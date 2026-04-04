import psycopg2.extras
from db import get_connection

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
        print(f"DB ERROR: {e}")  # this is what's failing silently
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


def search_faces(user_id: str, thread_id: str, threshold: float = 0.45):
    """
    Find all photos in a thread where the user's face appears.
    
    cosine distance = 1 - cosine similarity
    <=> operator in pgvector = cosine distance
    So: similarity = 1 - distance
    threshold 0.45 similarity = 0.55 distance
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
            
            # Search for similar faces scoped to this thread
            # 1 - (embedding <=> query) converts distance to similarity
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
                ORDER BY similarity DESC
                """,
                (user_embedding, thread_id, user_embedding, threshold)
            )
            
            results = cur.fetchall()
            return [dict(r) for r in results]
    finally:
        conn.close()