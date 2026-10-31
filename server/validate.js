import { ApiError } from './http.js'
import { isDateStr, parseHHMM } from '../shared/time.js'

// Collects field errors, then throws one 400 listing all of them.
export class Validator {
  constructor(src) { this.src = src && typeof src === 'object' ? src : {}; this.errors = {}; this.out = {} }
  fail(field, msg) { if (!this.errors[field]) this.errors[field] = msg }
  raw(f) { return this.src[f] }

  str(f, { min = 0, max = 500, required = false, pattern } = {}) {
    let v = this.src[f]
    if (v === undefined || v === null || v === '') { if (required) this.fail(f, 'Required'); return (this.out[f] = null) }
    if (typeof v !== 'string') { this.fail(f, 'Must be text'); return null }
    v = v.trim()
    if (v.length < Math.max(min, required ? 1 : 0)) this.fail(f, `Must be at least ${Math.max(min, 1)} characters`)
    if (v.length > max) this.fail(f, `Must be at most ${max} characters`)
    if (pattern && v && !pattern.test(v)) this.fail(f, 'Invalid format')
    return (this.out[f] = v)
  }
  int(f, { min = -Infinity, max = Infinity, required = false } = {}) {
    const v = this.src[f]
    if (v === undefined || v === null || v === '') { if (required) this.fail(f, 'Required'); return (this.out[f] = null) }
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) { this.fail(f, `Must be a whole number between ${min} and ${max}`); return null }
    return (this.out[f] = n)
  }
  num(f, { min = -Infinity, max = Infinity, required = false } = {}) {
    const v = this.src[f]
    if (v === undefined || v === null || v === '') { if (required) this.fail(f, 'Required'); return (this.out[f] = null) }
    const n = Number(v)
    if (!Number.isFinite(n) || n < min || n > max) { this.fail(f, `Must be a number between ${min} and ${max}`); return null }
    return (this.out[f] = n)
  }
  oneOf(f, allowed, { required = true, fallback = null } = {}) {
    const v = this.src[f]
    if (v === undefined || v === null || v === '') { if (required && fallback === null) this.fail(f, 'Required'); return (this.out[f] = fallback) }
    if (!allowed.includes(v)) { this.fail(f, `Must be one of: ${allowed.join(', ')}`); return null }
    return (this.out[f] = v)
  }
  bool(f, fallback = false) { const v = this.src[f]; return (this.out[f] = v === undefined ? fallback : v === true || v === 'true') }
  date(f, { required = false } = {}) {
    const v = this.src[f]
    if (v === undefined || v === null || v === '') { if (required) this.fail(f, 'Required'); return (this.out[f] = null) }
    if (!isDateStr(v)) { this.fail(f, 'Use YYYY-MM-DD'); return null }
    return (this.out[f] = v)
  }
  timestamp(f, { required = false } = {}) {
    const v = this.src[f]
    if (v === undefined || v === null || v === '') { if (required) this.fail(f, 'Required'); return (this.out[f] = null) }
    const t = Date.parse(v)
    if (Number.isNaN(t)) { this.fail(f, 'Invalid date/time'); return null }
    return (this.out[f] = new Date(t).toISOString())
  }
  email(f) {
    const v = this.str(f, { required: true, max: 254 })
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) this.fail(f, 'Invalid email')
    return v && v.toLowerCase()
  }
  array(f, { max = 200, required = false } = {}) {
    const v = this.src[f]
    if (v === undefined || v === null) { if (required) this.fail(f, 'Required'); return (this.out[f] = []) }
    if (!Array.isArray(v) || v.length > max) { this.fail(f, `Must be a list of at most ${max} items`); return [] }
    return (this.out[f] = v)
  }
  done() {
    if (Object.keys(this.errors).length) throw new ApiError(400, 'Validation failed', this.errors)
    return this.out
  }
}

export const TIME_RE = parseHHMM
export const ID = (v, name = 'id') => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, `Invalid ${name}`)
  return n
}
