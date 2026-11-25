// Thin REST client. Session lives in localStorage.
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')

const SESSION_KEY = 'dndcompanion.session'

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // storage unavailable (private mode) - session lasts for this tab only
  }
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Błąd ${status}`)
    this.status = status
    this.body = body
  }
}

// "Waking up the server" signal: Render's free plan sleeps after ~15 min idle.
let slowCount = 0
const listeners = new Set()
export const subscribeSlow = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const isSlow = () => slowCount > 0
const emit = () => listeners.forEach((fn) => fn())

let token = loadSession()?.token ?? null
export const setToken = (t) => { token = t }

export async function api(method, path, body) {
  let slow = false
  const timer = setTimeout(() => { slow = true; slowCount += 1; emit() }, 2500)
  try {
    const res = await fetch(API_URL + path, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
    if (!res.ok) throw new ApiError(res.status, data)
    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(0, { error: 'Brak połączenia z serwerem.' })
  } finally {
    clearTimeout(timer)
    if (slow) { slowCount -= 1; emit() }
  }
}
