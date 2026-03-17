-- Migration: 003_labels_categories
-- Adds categories table and label/category_id columns to media

CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_owner_unique UNIQUE (name, created_by)
);

ALTER TABLE media
  ADD COLUMN IF NOT EXISTS label       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_created_by      ON categories(created_by);
CREATE INDEX IF NOT EXISTS idx_media_category_id          ON media(category_id);
CREATE INDEX IF NOT EXISTS idx_media_category_uploaded_at ON media(category_id, uploaded_at DESC);
