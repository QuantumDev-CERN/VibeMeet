"""Postgres + Redis connections for the ML service."""
import psycopg2
import psycopg2.extras
import redis
from dotenv import load_dotenv
import os

load_dotenv()

def get_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))

# Separate Redis client from Node's — RQ needs its own Python-side connection.
# Same REDIS_URL / same Redis container, just a different client library.
_redis_client = None

def get_redis():
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(os.getenv("REDIS_URL"))
    return _redis_client