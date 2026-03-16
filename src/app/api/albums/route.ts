import { NextRequest } from 'next/server';
import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { createAlbumSchema } from '@/lib/schemas/albums';
import { ok, err } from '@/lib/api/response';

interface AlbumRow {
  id: string;
  name: string;
  created_by: string;
  created_at: Date;
}

export async function POST(request: NextRequest) {
  // Auth guaranteed by middleware; retrieve session for userId
  const session = (await getValidSession())!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const parsed = createAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body', 400);
  }

  const { name } = parsed.data;

  const result = await query<AlbumRow>(
    `INSERT INTO albums (name, created_by, created_at)
     VALUES ($1, $2, now())
     RETURNING id, name, created_by, created_at`,
    [name, session.userId]
  );

  return ok(result.rows[0]);
}

export async function GET() {
  const result = await query<AlbumRow>(
    `SELECT id, name, created_by, created_at
     FROM albums
     ORDER BY created_at DESC`
  );

  return ok(result.rows);
}
