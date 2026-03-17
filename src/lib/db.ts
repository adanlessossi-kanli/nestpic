import 'server-only';
import pg, { type QueryResultRow } from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
