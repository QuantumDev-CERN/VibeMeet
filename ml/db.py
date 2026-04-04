"""PostgreSQL connection placeholder for the ML service."""
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
import os

load_dotenv()

def get_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))