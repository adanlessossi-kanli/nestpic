import { getValidSession } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api/response';

interface CategoryRow {
  id: string;
  name: string;
  created_by: string;
  created_at: Date;
}

export async function GET() {
  const session = await getValidSession();
  if (!session) {
    return err('UNAUTHORIZED', 'Authentication required', 401);
  }

  const result = await query<CategoryRow>(
    `SELECT id, name, created_by, created_at
     FROM categories
     WHERE created_by = $1
     ORDER BY created_at DESC`,
    [session.userId]
  );

  const categories = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  }));

  return ok(categories);
}
