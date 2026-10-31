// Usage: npm run db:migrate   (needs DATABASE_URL)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../server/env.js'
import { getPool, closePool } from '../server/db.js'

loadEnv()
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
const pool = getPool()
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(r => r.name))
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(file)) { console.log('skip   ', file); continue }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(fs.readFileSync(path.join(dir, file), 'utf8'))
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file])
    await client.query('COMMIT')
    console.log('applied', file)
  } catch (e) {
    await client.query('ROLLBACK'); console.error('FAILED ', file, e.message); process.exitCode = 1; break
  } finally { client.release() }
}
await closePool()
