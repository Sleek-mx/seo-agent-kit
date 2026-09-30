import { Pool } from "pg";

// Minimal Postgres helper the PostHog libs import. Swap for your own db module if you have one.
export const dbConfigured = Boolean(process.env.DATABASE_URL);

let pool: Pool | null = null;
export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!dbConfigured) return [];
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "0" ? false : { rejectUnauthorized: false },
    max: 5,
  });
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
