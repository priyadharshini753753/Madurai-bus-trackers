import pg from 'pg'

let pool
export function getPool() {
  if (pool) return pool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const local = /@(localhost|127\.0\.0\.1)/.test(url)
  pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10000,
    ssl: local || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
  })
  return pool
}
export const query = (text, params) => getPool().query(text, params)
export async function tx(fn) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}
export async function closePool() { if (pool) { await pool.end(); pool = null } }
