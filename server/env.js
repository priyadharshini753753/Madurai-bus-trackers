// Loads .env / .env.local into process.env for local scripts and dev server.
// On Vercel, variables come from the project settings instead.
import fs from 'node:fs'
import path from 'node:path'

export function loadEnv(root = process.cwd()) {
  for (const f of ['.env', '.env.local']) {
    const p = path.join(root, f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m || process.env[m[1]] !== undefined) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
