CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_face_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  embedding     vector(512) NOT NULL,
  selfie_count  INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS communities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  banner_url  TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_members (
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,
  role          TEXT DEFAULT 'member',
  joined_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, community_id)
);

CREATE TABLE IF NOT EXISTS threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT,
  event_date    DATE,
  location      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     UUID REFERENCES threads(id) ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES users(id),
  storage_key   TEXT NOT NULL,
  url           TEXT NOT NULL,
  indexed       BOOLEAN DEFAULT false,
  face_count    INT DEFAULT 0,
  uploaded_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS face_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id    UUID REFERENCES photos(id) ON DELETE CASCADE,
  thread_id   UUID REFERENCES threads(id) ON DELETE CASCADE,
  embedding   vector(512) NOT NULL,
  bbox        JSONB,
  det_score   FLOAT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_faces (
  photo_id    UUID REFERENCES photos(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  confidence  FLOAT,
  confirmed   BOOLEAN DEFAULT false,
  PRIMARY KEY (photo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_face_embeddings_hnsw 
  ON face_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_face_embeddings_thread 
  ON face_embeddings(thread_id);
