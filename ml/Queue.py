"""
Background job queue — retries failed photo processing.

Two moving parts, run as two separate processes:
  1. This module's poll loop (`python Queue.py`) — queries Postgres for
     stuck photos and enqueues them into RQ. No Node changes needed;
     photos.js still fires the initial process-photo call itself. This
     poller only picks up photos that fell through (ML was down, R2 fetch
     failed, etc.) and are still indexed=false.
  2. An RQ worker (`rq worker photo-processing --url $REDIS_URL`) — pulls
     jobs off the queue and actually runs them via process_photo_job().

Why polling instead of Node enqueueing directly: keeps this entirely on
the Python side, no changes to the existing upload path, and the poll
query is cheap (indexed + retry_count are both indexed-able predicates
on a table that isn't huge).
"""
import time
import logging
from datetime import datetime, timezone

from rq import Queue
from db import get_connection, get_redis
from face import download_img, extract_faces
from search import store_face_embeddings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("worker")

# ── Tuning ────────────────────────────────────────────────────────────────
POLL_INTERVAL_SECONDS = 30      # how often the poller checks for stuck photos
BATCH_SIZE = 20                 # max photos enqueued per poll pass
MAX_RETRIES = 5                 # after this many failed attempts, stop retrying

# Consecutive-failure alerting: if this many jobs in a row fail (regardless
# of which photo), something systemic is probably broken (ML service down,
# GPU driver issue, DB connection exhausted) rather than N unrelated bad
# photos. We log a CRITICAL line so it's grep-able / hookable into whatever
# alerting you wire up later (this repo has no external alerting yet).
CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 5
CONSECUTIVE_FAILURE_REDIS_KEY = "worker:consecutive_failures"

QUEUE_NAME = "photo-processing"


def get_queue():
    return Queue(QUEUE_NAME, connection=get_redis())


def _record_success():
    # Reset the consecutive-failure streak on any success.
    get_redis().set(CONSECUTIVE_FAILURE_REDIS_KEY, 0)


def _record_failure():
    r = get_redis()
    count = r.incr(CONSECUTIVE_FAILURE_REDIS_KEY)
    # Alert once per threshold crossed (5, 10, 15...) rather than every
    # single failure once past the threshold — avoids log-spamming during
    # a genuine outage while still re-alerting if it keeps going.
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
        # store_face_embeddings sets indexed=true (and face_count, including
        # the face_count=0 case) itself — just clear any stale error state.
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


def poll_and_enqueue():
    """
    Finds photos stuck at indexed=false that haven't exhausted retries,
    and enqueues them — skipping any already sitting in the queue.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, thread_id, url
                FROM photos
                WHERE indexed = false AND retry_count < %s
                ORDER BY uploaded_at ASC
                LIMIT %s
                """,
                (MAX_RETRIES, BATCH_SIZE)
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return

    queue = get_queue()
    enqueued = 0
    for photo_id, thread_id, url in rows:
        # job_id = photo_id makes this idempotent: if the photo is already
        # queued or running under this same id, RQ just returns the
        # existing job instead of creating a duplicate.
        existing = queue.fetch_job(str(photo_id))
        if existing is not None and existing.get_status() in ("queued", "started", "deferred"):
            continue
        queue.enqueue(process_photo_job, str(photo_id), str(thread_id), url, job_id=str(photo_id))
        enqueued += 1

    if enqueued:
        log.info(f"Enqueued {enqueued} stuck photo(s) for reprocessing")


def run_poller():
    log.info(f"Poller started — checking every {POLL_INTERVAL_SECONDS}s, max {MAX_RETRIES} retries per photo")
    while True:
        try:
            poll_and_enqueue()
        except Exception as e:
            # Poller itself failing (e.g. DB down) shouldn't kill the loop —
            # log and try again next interval.
            log.error(f"Poll pass failed: {e}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_poller()
