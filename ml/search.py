"""pgvector-backed search logic placeholder."""
import psycopg2.extrasfrom db import get_connection

def store_face_embeddings(photo_id: str, thread_id: str, faces: list):
    #Bulk insert all face embeddings from a photo into pgvector

    if not faces:
        return
    conn = get_connection()
    try:
        with conn.cursor() as curr:
            #execute_values gives better performance then looping to insert especially for more than 20+ faces

            psycopg2.extras.execute_values(
                curr,
                """
                INSERT INTO face_embeddings
                            (photo_id, thread_id, embedding, bbox, det_score)
                VALUES %s
                """,
                [
                    (
                        photo_id,
                        thread_id,
                        face['embedding'],  #pgvector accepts python lists
                        face['det_score']
                    )
                    for face in faces
                ]
            )

            #Mark the photo as processed
            curr.execute(
                """
                UPDATE photos 
                SET indexed = true, face_count = %s
                WHERE id = %s

                """,
                (len(faces), photo_id)

            )
        conn.commit()
    finally:
        conn.close()


def search_faces(user_id: str, thread_id: str, threshold: float = 0.45):
    """ 
    Find all photos in a thread where the user's face appears.

    cosine distance = 1 - consine similarity
    <=> operator in pgvector = cosine distance 
    So: similarity = 1 - distance 
    threshold 0.45 similarity = 0.55 distance 

    """

    conn = get_connection()
    try:
        with conn.cursor(cursor_factory = psycopg2.extras.RealDictCursor) as cur:

            #First get user's stored embedding
            curr.execute(
                "SELECT embedding FROM user_face_embeddings WHERE user_id = %s",
                (user_id,)
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("User has no registered face embedding")
            user_embedding = row['embedding']

            #Search for similar faces scoped to this thread
            #1 - (embedding <=> query ) converts distance to similarity

            curr.execute(
                """ 
                SELECT 
                    photo_id,
                    bbox,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM face_embeddings
                WHERE 
                    thread_id = %s
                    AND 1 - (embedding <=> %s::vector) > %s
                ORDER BY  similarity DESC
                """,
                (user_embedding, thread_id, user_embedding, threshold)
            )

            results = curr.fetchall()
            return [dict(r) for r in results]
    finally:
        conn.close()