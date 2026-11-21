import pool from '../db.js';

// Ported from ml/search.py search_faces(). It was pure pgvector SQL and never
// used the model, so it runs here and search no longer depends on the ML service.
const DET_SCORE_THRESHOLD = 0.7;
const SEARCH_LIMIT = 100;

export async function searchFaces(userId, threadId, threshold = 0.6, limit = SEARCH_LIMIT) {
    const { rows } = await pool.query(
        `WITH u AS (
             SELECT embedding
             FROM user_face_embeddings
             WHERE user_id = $1 AND active = true
         )
         SELECT fe.photo_id,
                fe.bbox,
                1 - (fe.embedding <=> u.embedding) AS similarity
         FROM face_embeddings fe, u
         WHERE fe.thread_id = $2
           AND 1 - (fe.embedding <=> u.embedding) > $3
           AND fe.det_score > $4
         ORDER BY similarity DESC
         LIMIT $5`,
        [userId, threadId, threshold, DET_SCORE_THRESHOLD, limit]
    );
    return rows; // [{ photo_id, bbox, similarity }]
}
