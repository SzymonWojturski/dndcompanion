import { createClient } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Foreign keys are declared for documentation only: Turso over HTTP does not keep
// connection PRAGMAs, so the app deletes dependent rows itself.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  dm_password_hash TEXT NOT NULL,
  player_password_hash TEXT NOT NULL,
  units TEXT NOT NULL DEFAULT 'lb',
  encumbrance_mode TEXT NOT NULL DEFAULT 'simple',
  party_capacity REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 10,
  size TEXT NOT NULL DEFAULT 'medium',
  powerful_build INTEGER NOT NULL DEFAULT 0,
  capacity_modifier REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (campaign_id, name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight REAL NOT NULL DEFAULT 0,
  size REAL,
  category TEXT NOT NULL DEFAULT 'inne',
  stackable INTEGER NOT NULL DEFAULT 0,
  is_container INTEGER NOT NULL DEFAULT 0,
  capacity_weight REAL,
  capacity_size REAL,
  contents_multiplier REAL NOT NULL DEFAULT 1,
  extradimensional INTEGER NOT NULL DEFAULT 0,
  allowed_categories TEXT
);
CREATE INDEX IF NOT EXISTS items_campaign ON items (campaign_id);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('player', 'party')),
  owner_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT REFERENCES entries(id),
  equipped INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  weight_override REAL
);
CREATE INDEX IF NOT EXISTS entries_owner ON entries (campaign_id, owner_type, owner_id);
CREATE INDEX IF NOT EXISTS entries_parent ON entries (parent_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  role TEXT NOT NULL CHECK (role IN ('dm', 'player')),
  player_id TEXT REFERENCES players(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player_id);
`

// libsql rejects undefined; SQL wants 0/1 for booleans.
const clean = (args) => {
  const fix = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)
  if (Array.isArray(args)) return args.map(fix)
  if (args && typeof args === 'object') return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, fix(v)]))
  return args
}

// Same small interface for the client and for an open transaction.
function wrap(exec) {
  return {
    all: async (sql, args = []) => (await exec({ sql, args: clean(args) })).rows,
    get: async (sql, args = []) => (await exec({ sql, args: clean(args) })).rows[0],
    run: async (sql, args = []) => exec({ sql, args: clean(args) }),
  }
}

export const stmt = (sql, args = []) => ({ sql, args: clean(args) })

// url: libsql://... (Turso), file:path.db (local) ; authToken only for Turso.
export async function openDb({ url, authToken }) {
  if (url.startsWith('file:')) {
    const path = url.slice('file:'.length)
    mkdirSync(dirname(path), { recursive: true })
  }
  const client = createClient({ url, authToken })
  await client.executeMultiple(SCHEMA)
  return {
    ...wrap((s) => client.execute(s)),
    // Atomic list of independent writes (one round trip on Turso).
    batch: (stmts) => client.batch(stmts, 'write'),
    // Interactive transaction for read-then-write sequences.
    async tx(fn) {
      const t = await client.transaction('write')
      try {
        const out = await fn(wrap((s) => t.execute(s)))
        await t.commit()
        return out
      } catch (err) {
        await t.rollback().catch(() => {})
        throw err
      } finally {
        t.close()
      }
    },
    close: () => client.close(),
  }
}

// Row mappers: snake_case rows -> API objects.
export const toCampaign = (r) => r && {
  id: r.id,
  name: r.name,
  joinCode: r.join_code,
  units: r.units,
  encumbranceMode: r.encumbrance_mode,
  partyCapacity: r.party_capacity,
}

export const toPlayer = (r) => r && {
  id: r.id,
  campaignId: r.campaign_id,
  name: r.name,
  strength: r.strength,
  size: r.size,
  powerfulBuild: !!r.powerful_build,
  capacityModifier: r.capacity_modifier,
}

export const toItem = (r) => r && {
  id: r.id,
  name: r.name,
  description: r.description,
  weight: r.weight,
  size: r.size,
  category: r.category,
  stackable: !!r.stackable,
  isContainer: !!r.is_container,
  capacityWeight: r.capacity_weight,
  capacitySize: r.capacity_size,
  contentsMultiplier: r.contents_multiplier,
  extradimensional: !!r.extradimensional,
  allowedCategories: r.allowed_categories ? JSON.parse(r.allowed_categories) : null,
}

export const toEntry = (r) => r && {
  id: r.id,
  ownerType: r.owner_type,
  ownerId: r.owner_id,
  itemId: r.item_id,
  quantity: r.quantity,
  parentId: r.parent_id,
  equipped: !!r.equipped,
  notes: r.notes,
  weightOverride: r.weight_override,
}
