import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(expected, actual)
}

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token) => createHash('sha256').update(token).digest('hex')
export const newId = () => randomUUID()

// Join codes avoid look-alike characters (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function newJoinCode(length = 6) {
  const bytes = randomBytes(length)
  let code = ''
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return code
}

// Small fixed-window limiter for login/creation endpoints (per IP, in memory).
export function rateLimit({ windowMs, max }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip
    const rec = hits.get(key)
    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 })
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k)
      }
      return next()
    }
    rec.count += 1
    if (rec.count > max) {
      return res.status(429).json({ error: 'Za dużo prób. Spróbuj za chwilę.' })
    }
    next()
  }
}
