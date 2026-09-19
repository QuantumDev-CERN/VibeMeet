import time
import logging
from rq import Queue
from db import get_connection, get_redis
from jobs import process_photo_job, MAX_RETRIES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("worker")

POLL_INTERVAL_SECONDS = 30      
BATCH_SIZE = 20                 
QUEUE_NAME = "photo-processing"

def get_queue():
    return Queue(QUEUE_NAME, connection=get_redis())

def poll_and_enqueue():
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
            log.error(f"Poll pass failed: {e}")
        time.sleep(POLL_INTERVAL_SECONDS)
if __name__ == "__main__":
    run_poller()