import logging
from datetime import datetime
from db import get_connection, get_redis
from face import download_img, extract_faces
from search import store_face_embeddings

log = logging.getLogger("worker")

MAX_RETRIES = 5

CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 5
CONSECUTIVE_FAILURE_REDIS_KEY = "worker:consecutive_failures"

def _record_success():
    get_redis().set(CONSECUTIVE_FAILURE_REDIS_KEY, 0)

def _record_failure():
    r = get_redis()
    count = r.incr(CONSECUTIVE_FAILURE_REDIS_KEY)
    if count % CONSECUTIVE_FAILURE_ALERT_THRESHOLD == 0:
        log.critical(
            f"Critical: {count} consecutive photo-processing failures. "
        )
    return count

def process_photo_job(photo_id: str, thread_id: str, image_url: str):
    conn = get_connection()
    try:
        img = download_img(image_url)
        faces = extract_faces(img)
        store_face_embeddings(photo_id, thread_id, faces)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE photos SET retry_count = 0, last_error = NULL, "
                "last_attempted_at = %s WHERE id = %s",
                (datetime.now(), photo_id)
            )
        conn.commit()
        log.info(f"Processed photo {photo_id} ({len(faces)} faces)")
        _record_success()

    except Exception as e:
        log.error(f"Failed processing photo {photo_id}: {e}")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE photos
                    SET retry_count = retry_count + 1,
                        last_error = %s,
                        last_attempted_at = %s
                    WHERE id = %s
                    RETURNING retry_count
                    """,
                    (str(e)[:2000], datetime.now(), photo_id)
                )
                new_count = cur.fetchone()[0]
            conn.commit()
            if new_count >= MAX_RETRIES:
                log.warning(f"Photo {photo_id} hit MAX_RETRIES ({MAX_RETRIES})")
        except Exception as db_err:
            log.error(f"Also failed to record retry state for {photo_id}: {db_err}")
        _record_failure()

    finally:
        conn.close()