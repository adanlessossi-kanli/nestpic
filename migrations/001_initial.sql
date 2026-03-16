-- Migration: 001_initial
-- Creates all initial tables for the Nestpic application

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id),
  used_by    UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id   UUID NOT NULL REFERENCES users(id),
  s3_key        VARCHAR(500) NOT NULL,
  thumbnail_key VARCHAR(500),
  content_type  VARCHAR(100) NOT NULL,
  file_size     BIGINT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_status_check CHECK (status IN ('pending', 'active'))
);

CREATE TABLE IF NOT EXISTS albums (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS album_media (
  album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, media_id)
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          VARCHAR(255) NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_media_uploader_id   ON media(uploader_id);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at   ON media(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_album_media_album_id ON album_media(album_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
