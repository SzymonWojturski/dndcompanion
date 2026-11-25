import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
// Production: Turso (libsql://...). Locally: a SQLite file.
const dbUrl = process.env.TURSO_DATABASE_URL || `file:${process.env.DB_PATH ?? './data/dndcompanion.db'}`
const dbAuthToken = process.env.TURSO_AUTH_TOKEN || undefined
const corsOrigin = process.env.CORS_ORIGIN ?? '*'

const { app } = await createApp({ dbUrl, dbAuthToken, corsOrigin })
app.listen(port, () => {
  const where = dbUrl.startsWith('file:') ? dbUrl : dbUrl.replace(/\/\/([^.]+)/, '//***')
  console.log(`DnD Companion API on :${port} (db: ${where}, cors: ${corsOrigin})`)
})
