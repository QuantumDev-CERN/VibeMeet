-- VibeMeet database schema scaffold.
-- Enable extensions and define core tables as the implementation evolves.

CREATE EXTENSION IF NOT EXISTS vector;

-- Users who can authenticate and participate in communities.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Community hubs identified by a human-friendly slug.
CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Discussion threads or event posts inside communities.
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY,
  community_id UUID NOT NULL REFERENCES communities(id),
  author_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Photos uploaded for threads and community activity.
CREATE TABLE IF NOT EXISTS photos (
  id UUID PRIMARY KEY,
  thread_id UUID REFERENCES threads(id),
  uploader_id UUID REFERENCES users(id),
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Face embeddings used for selfie search and matching.
CREATE TABLE IF NOT EXISTS face_embeddings (
  id UUID PRIMARY KEY,
  photo_id UUID NOT NULL REFERENCES photos(id),
  embedding VECTOR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
