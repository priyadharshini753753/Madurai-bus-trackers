// Tiny key-value store on IndexedDB (falls back to memory if unavailable, e.g. private mode).
const DB = 'madurai-bus', STORE = 'kv'
let dbp
const mem = new Map()

function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
async function run(mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const out = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(out.result)
    tx.onerror = () => reject(tx.error)
  })
}
const safe = async (fn, fallback) => { try { return await fn() } catch { return fallback() } }

export const idb = {
  get: key => safe(() => run('readonly', s => s.get(key)), () => mem.get(key)),
  set: (key, value) => safe(() => run('readwrite', s => s.put(value, key)), () => { mem.set(key, value) }),
  del: key => safe(() => run('readwrite', s => s.delete(key)), () => { mem.delete(key) }),
  async list(prefix) {
    return safe(async () => {
      const db = await open()
      return new Promise((resolve, reject) => {
        const out = []
        const req = db.transaction(STORE).objectStore(STORE).openCursor()
        req.onsuccess = () => {
          const c = req.result
          if (!c) return resolve(out)
          if (String(c.key).startsWith(prefix)) out.push(c.value)
          c.continue()
        }
        req.onerror = () => reject(req.error)
      })
    }, () => [...mem.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v))
  },
}
