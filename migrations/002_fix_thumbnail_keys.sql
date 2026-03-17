-- Migration: 002_fix_thumbnail_keys
-- Nullify any thumbnail_key values that incorrectly point to the originals/ prefix.
-- These were written by an early version of the thumbnail worker before the
-- thumbnails/ prefix was enforced. Setting them to NULL causes the worker to
-- re-process those media items on the next poll cycle.

UPDATE media
SET thumbnail_key = NULL
WHERE thumbnail_key IS NOT NULL
  AND thumbnail_key NOT LIKE 'thumbnails/%';
