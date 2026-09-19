"""
RQ job definitions — deliberately kept out of Queue.py.

RQ pickles a job by its module.qualname and the worker process
re-imports that module by name to run it. A script launched directly
(`python Queue.py`) has __name__ == "__main__" for that run — so a job
function *defined inside that script* gets pickled as
`__main__.process_photo_job`. The separate `rq worker` process never
runs Queue.py as __main__, so it can't resolve that reference. That's
exactly the "Functions from the __main__ module cannot be processed
by workers" error.

Living here, this module's real name is always "jobs" no matter which
script imports it, so poller and worker agree on the reference.
"""
import logging
from datetime import datetime, timezone

from db import get_connection, get_redis
from face import download_img, extract_faces
from search import store_face_embeddings

log = logging.getLogger("worker")

MAX_RETRIES = 5

# Consecutive-failure alerting: if this many jobs in a row fail (regardless
# of which photo), something systemic is probably broken (ML service down,
# GPU driver issue, DB connection exhausted) rather than N unrelated bad
# photos. We log a CRITICAL line so it's grep-able / hookable into whatever
# alerting you wire up later (this repo has no external alerting yet).
CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 5
CONSECUTIVE_FAILURE_REDIS_KEY = "worker:consecutive_failures"


def _record_success():
    # Reset the consecutive-failure streak on any success.
    get_redis().set(CONSECUTIVE_FAILURE_REDIS_KEY, 0)


def _record_failure():
    r = get_redis()
    count = r.incr(CONSECUTIVE_FAILURE_REDIS_KEY)
    if count % CONSECUTIVE_FAILURE_ALERT_THRESHOLD == 0:
        log.critical(
            f"ALERT: {count} consecutive photo-processing failures. "
            f"Check ML service health, R2 connectivity, and DB connection pool."
        )
    return count


def process_photo_job(photo_id: str, thread_id: str, image_url: str):
    """
    RQ job body. Mirrors what main.py's /process-photo does, but runs
    in-process (no HTTP round-trip to the FastAPI service, which would
    otherwise be calling itself).

    Deliberately does NOT re-raise on failure — retries are tracked via
    our own retry_count column, not RQ's built-in failure/retry registry,
    so those two mechanisms don't get out of sync with each other.
    """
    conn = get_connection()
    try:
        img = download_img(image_url)
        faces = extract_faces(img)
        store_face_embeddings(photo_id, thread_id, faces)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE photos SET retry_count = 0, last_error = NULL, "
                "last_attempted_at = %s WHERE id = %s",
                (datetime.now(timezone.utc), photo_id)
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
                    (str(e)[:2000], datetime.now(timezone.utc), photo_id)
                )
                new_count = cur.fetchone()[0]
            conn.commit()
            if new_count >= MAX_RETRIES:
                log.warning(f"Photo {photo_id} hit MAX_RETRIES ({MAX_RETRIES}) — giving up, won't be re-polled")
        except Exception as db_err:
            log.error(f"Also failed to record retry state for {photo_id}: {db_err}")
        _record_failure()

    finally:
        conn.close()