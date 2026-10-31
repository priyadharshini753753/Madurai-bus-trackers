// Creates (or updates the password of) an admin/editor user.
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-secret' npm run admin:create
//   (optional) ADMIN_ROLE=editor
// Passwords are never stored in the repo; they come from the environment only.
import { loadEnv } from '../server/env.js'
import { query, closePool } from '../server/db.js'
import { hashPassword } from '../server/auth.js'

loadEnv()
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD || ''
const role = process.env.ADMIN_ROLE || 'admin'
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Set ADMIN_EMAIL to a valid email'); process.exit(1) }
if (password.length < 12) { console.error('ADMIN_PASSWORD must be at least 12 characters'); process.exit(1) }
if (!['admin', 'editor'].includes(role)) { console.error('ADMIN_ROLE must be admin or editor'); process.exit(1) }

await query(
  `INSERT INTO users(email, password_hash, role) VALUES ($1,$2,$3)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
     is_active = TRUE, failed_attempts = 0, locked_until = NULL`,
  [email, await hashPassword(password), role])
console.log(`User ${email} saved with role ${role}`)
await closePool()
