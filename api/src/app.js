import express from 'express'
import cors from 'cors'
import { openDb, stmt, toCampaign, toEntry, toItem, toPlayer } from './db.js'
import { hashPassword, hashToken, newId, newJoinCode, newToken, rateLimit, verifyPassword } from './auth.js'
import { MAX_DEPTH, SIZE_ORDER, buildTree, capacityFor, encumbrance, round } from './calc.js'
import { CONTAINER_TEMPLATES } from './templates.js'

export const CATEGORIES = ['bron', 'zbroja', 'amunicja', 'sprzet', 'mikstura', 'magiczny', 'pojemnik', 'inne']

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra) }

// ── input validation ──
function str(v, name, { min = 1, max = 200, optional = false } = {}) {
  if (v === undefined && optional) return undefined
  if (typeof v !== 'string') fail(400, `Pole "${name}" musi być tekstem.`)
  const s = v.trim()
  if (s.length < min || s.length > max) fail(400, `Pole "${name}" musi mieć od ${min} do ${max} znaków.`)
  return s
}
function num(v, name, { min = -Infinity, max = Infinity, int = false, optional = false, nullable = false } = {}) {
  if (v === undefined && optional) return undefined
  if ((v === null || v === '') && nullable) return null
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(400, `Pole "${name}" musi być liczbą.`)
  if (int && !Number.isInteger(n)) fail(400, `Pole "${name}" musi być liczbą całkowitą.`)
  if (n < min || n > max) fail(400, `Pole "${name}" musi być w zakresie ${min}–${max}.`)
  return n
}
function bool(v, name, { optional = false } = {}) {
  if (v === undefined && optional) return undefined
  if (typeof v !== 'boolean') fail(400, `Pole "${name}" musi być true/false.`)
  return v
}
function oneOf(v, name, values, { optional = false } = {}) {
  if (v === undefined && optional) return undefined
  if (!values.includes(v)) fail(400, `Pole "${name}" musi być jednym z: ${values.join(', ')}.`)
  return v
}
const password = (v, name) => str(v, name, { min: 4, max: 200 })

// Collects "col = ?" pairs for UPDATE, skipping undefined values.
function updates() {
  const sets = []
  const vals = []
  return {
    add(col, v) { if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v) } },
    get empty() { return sets.length === 0 },
    sql: (table, where) => `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`,
    vals,
  }
}

const SQL = {
  campaign: 'SELECT * FROM campaigns WHERE id = ?',
  campaignByCode: 'SELECT * FROM campaigns WHERE join_code = ?',
  player: 'SELECT * FROM players WHERE id = ? AND campaign_id = ?',
  playerByName: 'SELECT * FROM players WHERE campaign_id = ? AND name = ? COLLATE NOCASE',
  players: 'SELECT * FROM players WHERE campaign_id = ? ORDER BY name COLLATE NOCASE',
  items: 'SELECT * FROM items WHERE campaign_id = ? ORDER BY name COLLATE NOCASE',
  item: 'SELECT * FROM items WHERE id = ? AND campaign_id = ?',
  entry: 'SELECT * FROM entries WHERE id = ? AND campaign_id = ?',
  ownerEntries: 'SELECT * FROM entries WHERE campaign_id = ? AND owner_type = ? AND owner_id = ?',
  session: 'SELECT * FROM sessions WHERE token_hash = ?',
  insertSession: 'INSERT INTO sessions (token_hash, campaign_id, role, player_id, created_at) VALUES (?, ?, ?, ?, ?)',
  insertEntry: `INSERT INTO entries (id, campaign_id, owner_type, owner_id, item_id, quantity, parent_id, equipped, notes, weight_override)
    VALUES (@id, @campaign_id, @owner_type, @owner_id, @item_id, @quantity, @parent_id, @equipped, @notes, @weight_override)`,
}

const entryRow = (campaignId, e) => ({
  id: e.id, campaign_id: campaignId, owner_type: e.ownerType, owner_id: e.ownerId,
  item_id: e.itemId, quantity: e.quantity, parent_id: e.parentId ?? null,
  equipped: Number(!!e.equipped), notes: e.notes ?? '', weight_override: e.weightOverride ?? null,
})

const ITEM_COLS = {
  name: 'name', description: 'description', weight: 'weight', size: 'size', category: 'category',
  stackable: 'stackable', isContainer: 'is_container', capacityWeight: 'capacity_weight',
  capacitySize: 'capacity_size', contentsMultiplier: 'contents_multiplier',
  extradimensional: 'extradimensional', allowedCategories: 'allowed_categories',
}
const toCol = (k, v) => {
  if (typeof v === 'boolean') return Number(v)
  if (k === 'allowedCategories') return v ? JSON.stringify(v) : null
  return v
}
function insertItemStmt(campaignId, data, id = newId()) {
  const cols = ['id', 'campaign_id']
  const vals = [id, campaignId]
  for (const [k, col] of Object.entries(ITEM_COLS)) {
    if (data[k] !== undefined) { cols.push(col); vals.push(toCol(k, data[k])) }
  }
  return { id, stmt: stmt(`INSERT INTO items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals) }
}

function itemInput(b, partial) {
  const opt = { optional: partial }
  const out = {
    name: str(b.name, 'nazwa', { max: 120, ...opt }),
    description: b.description === undefined && partial ? undefined : str(b.description ?? '', 'opis', { min: 0, max: 2000 }),
    weight: num(b.weight ?? (partial ? undefined : 0), 'waga', { min: 0, max: 100000, ...opt }),
    size: num(b.size, 'rozmiar', { min: 0, max: 100000, optional: true, nullable: true }),
    category: oneOf(b.category ?? (partial ? undefined : 'inne'), 'kategoria', CATEGORIES, opt),
    stackable: bool(b.stackable ?? (partial ? undefined : false), 'stackable', opt),
    isContainer: bool(b.isContainer ?? (partial ? undefined : false), 'pojemnik', opt),
    capacityWeight: num(b.capacityWeight, 'udźwig pojemnika', { min: 0, max: 100000, optional: true, nullable: true }),
    capacitySize: num(b.capacitySize, 'pojemność', { min: 0, max: 100000, optional: true, nullable: true }),
    contentsMultiplier: num(b.contentsMultiplier ?? (partial ? undefined : 1), 'mnożnik zawartości', { min: 0, max: 1, ...opt }),
    extradimensional: bool(b.extradimensional ?? (partial ? undefined : false), 'pozawymiarowy', opt),
    allowedCategories: undefined,
  }
  if (b.allowedCategories !== undefined) {
    if (b.allowedCategories === null || (Array.isArray(b.allowedCategories) && b.allowedCategories.length === 0)) {
      out.allowedCategories = null
    } else if (Array.isArray(b.allowedCategories)) {
      out.allowedCategories = b.allowedCategories.map((c) => oneOf(c, 'dozwolone kategorie', CATEGORIES))
    } else fail(400, 'Pole "dozwolone kategorie" musi być listą.')
  }
  return out
}

// dbUrl: libsql://... (Turso) or file:path.db (local / tests)
export async function createApp({ dbUrl, dbAuthToken, corsOrigin = '*' }) {
  const db = await openDb({ url: dbUrl, authToken: dbAuthToken })
  const app = express()
  app.set('trust proxy', 1)
  app.use(cors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
  }))
  app.use(express.json({ limit: '5mb' }))

  const authLimiter = rateLimit({ windowMs: 60_000, max: 20 })

  const getCampaign = async (id, c = db) => toCampaign(await c.get(SQL.campaign, [id]))
  const itemsMap = async (campaignId, c = db) =>
    new Map((await c.all(SQL.items, [campaignId])).map((r) => [r.id, toItem(r)]))
  const ownerEntries = async (campaignId, owner, c = db) =>
    (await c.all(SQL.ownerEntries, [campaignId, owner.type, owner.id])).map(toEntry)

  async function startSession(campaignId, role, playerId = null) {
    const token = newToken()
    await db.run(SQL.insertSession, [hashToken(token), campaignId, role, playerId, Date.now()])
    return token
  }

  // ── auth middleware ──
  async function requireAuth(req, _res, next) {
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) fail(401, 'Brak sesji.')
    const s = await db.get(SQL.session, [hashToken(token)])
    if (!s) fail(401, 'Sesja wygasła. Zaloguj się ponownie.')
    req.auth = { campaignId: s.campaign_id, role: s.role, playerId: s.player_id, tokenHash: s.token_hash }
    next()
  }
  function requireDm(req, _res, next) {
    if (req.auth.role !== 'dm') fail(403, 'Tylko DM może to zrobić.')
    next()
  }

  // ── owners & permissions ──
  async function resolveOwner(campaignId, ownerType, ownerId, c = db) {
    if (ownerType === 'party') return { type: 'party', id: campaignId, name: 'Wspólny skarbiec' }
    if (ownerType === 'player') {
      const p = await c.get(SQL.player, [ownerId ?? '', campaignId])
      if (!p) fail(404, 'Nie ma takiej postaci.')
      return { type: 'player', id: p.id, name: p.name, player: toPlayer(p) }
    }
    fail(400, 'Nieznany właściciel.')
  }
  function canAccessOwner(auth, owner) {
    if (auth.role === 'dm') return true
    return owner.type === 'party' || owner.id === auth.playerId
  }

  // ── inventory views ──
  const serializeNode = (n) => ({
    id: n.id,
    itemId: n.itemId,
    item: n.item,
    quantity: n.quantity,
    notes: n.notes,
    equipped: n.equipped,
    weightOverride: n.weightOverride,
    unitWeight: n.unitWeight,
    totalWeight: n.totalWeight,
    contentsWeight: n.contentsWeight,
    contentsSize: n.contentsSize,
    children: n.children.map(serializeNode),
  })

  async function playerSummary(campaign, playerRow, items) {
    const player = toPlayer(playerRow)
    const tree = buildTree(await ownerEntries(campaign.id, { type: 'player', id: player.id }), items)
    return {
      ...player,
      ...capacityFor(player),
      totalWeight: tree.totalWeight,
      encumbrance: encumbrance(tree.totalWeight, player, campaign.encumbranceMode),
    }
  }

  async function inventoryView(campaign, owner) {
    const items = await itemsMap(campaign.id)
    const tree = buildTree(await ownerEntries(campaign.id, owner), items)
    const view = {
      owner: { type: owner.type, id: owner.id, name: owner.name },
      totalWeight: tree.totalWeight,
      roots: tree.roots.map(serializeNode),
    }
    if (owner.type === 'player') {
      const player = toPlayer(await db.get(SQL.player, [owner.id, campaign.id]))
      view.player = {
        ...player,
        ...capacityFor(player),
        totalWeight: tree.totalWeight,
        encumbrance: encumbrance(tree.totalWeight, player, campaign.encumbranceMode),
      }
    } else {
      view.partyCapacity = campaign.partyCapacity
    }
    return view
  }

  // Simulates placing `moving` (a subtree of entries, first one is its root) under
  // `parentId` of `owner` and returns the list of rule violations.
  async function placementProblems(campaign, owner, parentId, moving, items, c = db) {
    const problems = []
    const movingIds = new Set(moving.map((e) => e.id))
    const existing = (await ownerEntries(campaign.id, owner, c)).filter((e) => !movingIds.has(e.id))
    const root = moving[0]
    const placed = moving.map((e) => (e.id === root.id ? { ...e, parentId } : e))
    const all = [...existing, ...placed]
    const byId = new Map(all.map((e) => [e.id, e]))

    const ancestors = []
    let cur = parentId ? byId.get(parentId) : null
    if (parentId && !cur) fail(400, 'Docelowy pojemnik nie należy do tego właściciela.')
    while (cur) {
      if (movingIds.has(cur.id)) fail(400, 'Nie można włożyć pojemnika do samego siebie.')
      ancestors.push(cur)
      cur = cur.parentId ? byId.get(cur.parentId) : null
    }
    if (parentId) {
      const parentItem = items.get(byId.get(parentId).itemId)
      if (!parentItem?.isContainer) fail(400, 'Ten przedmiot nie jest pojemnikiem.')
      const rootItem = items.get(root.itemId)
      if (parentItem.allowedCategories?.length && !parentItem.allowedCategories.includes(rootItem.category)) {
        problems.push(`${parentItem.name} przyjmuje tylko: ${parentItem.allowedCategories.join(', ')}.`)
      }
    }

    // depth: deepest moved entry must have at most MAX_DEPTH containers above it
    const depthInSubtree = (id) => {
      let d = 0
      let e = byId.get(id)
      while (e && e.id !== root.id) { d += 1; e = byId.get(e.parentId) }
      return d
    }
    const deepest = Math.max(...moving.map((e) => depthInSubtree(e.id)))
    if (ancestors.length + deepest > MAX_DEPTH) {
      problems.push(`Za głębokie zagnieżdżenie (maksymalnie ${MAX_DEPTH} poziomy pojemników).`)
    }

    const extraAbove = ancestors.some((a) => items.get(a.itemId)?.extradimensional)
    const extraMoving = moving.some((e) => items.get(e.itemId)?.extradimensional)
    if (extraAbove && extraMoving) {
      problems.push('Przestrzeń pozawymiarowa w innej przestrzeni pozawymiarowej: oba przedmioty zostają zniszczone, a zawartość trafia na Plan Astralny.')
    }

    const tree = buildTree(all, items)
    for (const a of ancestors) {
      const node = tree.nodes.get(a.id)
      const item = node.item
      if (item.capacityWeight != null && node.contentsWeight > item.capacityWeight + 1e-9) {
        problems.push(`${item.name}: za ciężko (${round(node.contentsWeight)}/${item.capacityWeight} lb).`)
      }
      if (item.capacitySize != null && node.contentsSize > item.capacitySize + 1e-9) {
        problems.push(`${item.name}: za mało miejsca (${round(node.contentsSize)}/${item.capacitySize}).`)
      }
    }
    if (owner.type === 'party' && campaign.partyCapacity != null && tree.totalWeight > campaign.partyCapacity + 1e-9) {
      problems.push(`Skarbiec przepełniony (${tree.totalWeight}/${campaign.partyCapacity} lb).`)
    }
    return problems
  }

  function checkProblems(req, problems) {
    if (problems.length === 0) return
    const force = req.body?.force === true && req.auth.role === 'dm'
    if (!force) fail(409, problems[0], { problems, canForce: req.auth.role === 'dm' })
  }

  async function subtree(campaignId, rootEntry, c = db) {
    const rows = await ownerEntries(campaignId, { type: rootEntry.ownerType, id: rootEntry.ownerId }, c)
    const children = new Map()
    for (const r of rows) {
      if (!r.parentId) continue
      if (!children.has(r.parentId)) children.set(r.parentId, [])
      children.get(r.parentId).push(r)
    }
    const out = []
    const walk = (e) => { out.push(e); for (const ch of children.get(e.id) ?? []) walk(ch) }
    walk(rootEntry)
    return out
  }

  // Removes one entry; its contents fall out into its parent container.
  async function removeEntry(c, campaignId, id) {
    const fresh = await c.get(SQL.entry, [id, campaignId])
    if (!fresh) return
    await c.run('UPDATE entries SET parent_id = ? WHERE parent_id = ? AND campaign_id = ?', [fresh.parent_id, fresh.id, campaignId])
    await c.run('DELETE FROM entries WHERE id = ?', [fresh.id])
  }

  // Stackable items without notes merge into an identical stack at the same spot.
  async function insertOrMerge(c, campaignId, entry, items) {
    const item = items.get(entry.itemId)
    if (item?.stackable && !entry.notes && entry.weightOverride == null) {
      const twin = await c.get(`SELECT * FROM entries WHERE campaign_id = ? AND owner_type = ? AND owner_id = ? AND item_id = ?
        AND parent_id IS ? AND notes = '' AND weight_override IS NULL AND id != ?`,
      [campaignId, entry.ownerType, entry.ownerId, entry.itemId, entry.parentId ?? null, entry.id])
      const hasChildren = await c.get('SELECT 1 AS x FROM entries WHERE parent_id = ?', [entry.id])
      if (twin && !hasChildren) {
        await c.run('UPDATE entries SET quantity = quantity + ? WHERE id = ?', [entry.quantity, twin.id])
        await c.run('DELETE FROM entries WHERE id = ?', [entry.id])
        return twin.id
      }
    }
    if (await c.get(SQL.entry, [entry.id, campaignId])) {
      await c.run('UPDATE entries SET owner_type = ?, owner_id = ?, parent_id = ?, quantity = ? WHERE id = ?',
        [entry.ownerType, entry.ownerId, entry.parentId ?? null, entry.quantity, entry.id])
    } else {
      await c.run(SQL.insertEntry, entryRow(campaignId, entry))
    }
    return entry.id
  }

  // ── routes: public ──
  app.get('/health', (_req, res) => res.json({ ok: true }))

  app.post('/campaigns', authLimiter, async (req, res) => {
    const name = str(req.body?.name, 'nazwa', { max: 80 })
    const dmPassword = password(req.body?.dmPassword, 'hasło DM')
    const playerPassword = password(req.body?.playerPassword, 'hasło kampanii')
    if (dmPassword === playerPassword) fail(400, 'Hasło DM musi być inne niż hasło kampanii.')
    const id = newId()
    let joinCode
    do { joinCode = newJoinCode() } while (await db.get(SQL.campaignByCode, [joinCode]))
    await db.run(`INSERT INTO campaigns (id, name, join_code, dm_password_hash, player_password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`, [id, name, joinCode, hashPassword(dmPassword), hashPassword(playerPassword), Date.now()])
    const token = await startSession(id, 'dm')
    res.status(201).json({ token, role: 'dm', campaign: await getCampaign(id) })
  })

  const campaignFromCode = async (code) => {
    const c = await db.get(SQL.campaignByCode, [str(code, 'kod kampanii', { max: 20 }).toUpperCase()])
    if (!c) fail(404, 'Nie ma kampanii o takim kodzie.')
    return c
  }

  app.post('/auth/dm', authLimiter, async (req, res) => {
    const c = await campaignFromCode(req.body?.joinCode)
    if (!verifyPassword(req.body?.password ?? '', c.dm_password_hash)) fail(401, 'Złe hasło DM.')
    res.json({ token: await startSession(c.id, 'dm'), role: 'dm', campaign: toCampaign(c) })
  })

  app.post('/auth/join', authLimiter, async (req, res) => {
    const c = await campaignFromCode(req.body?.joinCode)
    if (!verifyPassword(req.body?.campaignPassword ?? '', c.player_password_hash)) fail(401, 'Złe hasło kampanii.')
    const name = str(req.body?.name, 'imię postaci', { max: 60 })
    const pw = password(req.body?.password, 'hasło postaci')
    const strength = num(req.body?.strength ?? 10, 'SIŁ', { min: 1, max: 30, int: true })
    if (await db.get(SQL.playerByName, [c.id, name])) fail(409, 'Postać o takim imieniu już istnieje. Zaloguj się.')
    const id = newId()
    try {
      await db.run(`INSERT INTO players (id, campaign_id, name, password_hash, strength, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [id, c.id, name, hashPassword(pw), strength, Date.now()])
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) fail(409, 'Postać o takim imieniu już istnieje. Zaloguj się.')
      throw err
    }
    res.status(201).json({
      token: await startSession(c.id, 'player', id), role: 'player', campaign: toCampaign(c),
      player: toPlayer(await db.get(SQL.player, [id, c.id])),
    })
  })

  app.post('/auth/player', authLimiter, async (req, res) => {
    const c = await campaignFromCode(req.body?.joinCode)
    const p = await db.get(SQL.playerByName, [c.id, str(req.body?.name, 'imię postaci', { max: 60 })])
    if (!p || !verifyPassword(req.body?.password ?? '', p.password_hash)) fail(401, 'Złe imię postaci lub hasło.')
    res.json({ token: await startSession(c.id, 'player', p.id), role: 'player', campaign: toCampaign(c), player: toPlayer(p) })
  })

  // ── routes: authenticated ──
  app.use(requireAuth)

  app.post('/auth/logout', async (req, res) => {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [req.auth.tokenHash])
    res.status(204).end()
  })

  app.get('/me', async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    const player = req.auth.playerId ? toPlayer(await db.get(SQL.player, [req.auth.playerId, campaign.id])) : null
    res.json({ role: req.auth.role, campaign, player, categories: CATEGORIES })
  })

  app.patch('/campaign', requireDm, async (req, res) => {
    const b = req.body ?? {}
    const id = req.auth.campaignId
    const u = updates()
    u.add('name', str(b.name, 'nazwa', { max: 80, optional: true }))
    u.add('units', oneOf(b.units, 'jednostki', ['lb', 'kg'], { optional: true }))
    u.add('encumbrance_mode', oneOf(b.encumbranceMode, 'tryb obciążenia', ['simple', 'variant'], { optional: true }))
    u.add('party_capacity', num(b.partyCapacity, 'udźwig skarbca', { min: 0, optional: true, nullable: true }))
    if (b.dmPassword) u.add('dm_password_hash', hashPassword(password(b.dmPassword, 'hasło DM')))
    if (b.playerPassword) u.add('player_password_hash', hashPassword(password(b.playerPassword, 'hasło kampanii')))
    if (!u.empty) await db.run(u.sql('campaigns', 'id = ?'), [...u.vals, id])
    res.json(await getCampaign(id))
  })

  // players
  app.get('/players', async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    const items = await itemsMap(campaign.id)
    const rows = (await db.all(SQL.players, [campaign.id]))
      .filter((p) => req.auth.role === 'dm' || p.id === req.auth.playerId)
    res.json(await Promise.all(rows.map((p) => playerSummary(campaign, p, items))))
  })

  app.patch('/players/:id', async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    const isDm = req.auth.role === 'dm'
    if (!isDm && req.params.id !== req.auth.playerId) fail(403, 'To nie Twoja postać.')
    const p = await db.get(SQL.player, [req.params.id, campaign.id])
    if (!p) fail(404, 'Nie ma takiej postaci.')
    const b = req.body ?? {}
    const u = updates()
    u.add('strength', num(b.strength, 'SIŁ', { min: 1, max: 30, int: true, optional: true }))
    if (isDm) {
      const name = str(b.name, 'imię postaci', { max: 60, optional: true })
      if (name && name.toLowerCase() !== p.name.toLowerCase() && await db.get(SQL.playerByName, [campaign.id, name])) {
        fail(409, 'Postać o takim imieniu już istnieje.')
      }
      u.add('name', name)
      u.add('size', oneOf(b.size, 'rozmiar', SIZE_ORDER, { optional: true }))
      const pb = bool(b.powerfulBuild, 'Powerful Build', { optional: true })
      u.add('powerful_build', pb === undefined ? undefined : Number(pb))
      u.add('capacity_modifier', num(b.capacityModifier, 'mnożnik udźwigu', { min: 0, max: 100, optional: true }))
      if (b.password) u.add('password_hash', hashPassword(password(b.password, 'hasło postaci')))
    } else {
      const forbidden = Object.keys(b).filter((k) => k !== 'strength')
      if (forbidden.length) fail(403, 'Możesz zmienić tylko SIŁ. Resztę ustawia DM.')
    }
    if (!u.empty) await db.run(u.sql('players', 'id = ?'), [...u.vals, p.id])
    if (isDm && b.password) await db.run('DELETE FROM sessions WHERE player_id = ?', [p.id])
    res.json(await playerSummary(campaign, await db.get(SQL.player, [p.id, campaign.id]), await itemsMap(campaign.id)))
  })

  // Removing a character moves their whole inventory to the party stash.
  app.delete('/players/:id', requireDm, async (req, res) => {
    const campaignId = req.auth.campaignId
    const p = await db.get(SQL.player, [req.params.id, campaignId])
    if (!p) fail(404, 'Nie ma takiej postaci.')
    await db.batch([
      stmt(`UPDATE entries SET owner_type = 'party', owner_id = ? WHERE campaign_id = ? AND owner_type = 'player' AND owner_id = ?`,
        [campaignId, campaignId, p.id]),
      stmt('DELETE FROM sessions WHERE player_id = ?', [p.id]),
      stmt('DELETE FROM players WHERE id = ?', [p.id]),
    ])
    res.status(204).end()
  })

  // item catalog
  app.get('/items', async (req, res) => {
    const rows = (await db.all(SQL.items, [req.auth.campaignId])).map(toItem)
    const usage = new Map((await db.all('SELECT item_id, COUNT(*) AS n FROM entries WHERE campaign_id = ? GROUP BY item_id',
      [req.auth.campaignId])).map((r) => [r.item_id, r.n]))
    res.json(rows.map((r) => ({ ...r, usedCount: usage.get(r.id) ?? 0 })))
  })

  app.post('/items', requireDm, async (req, res) => {
    const { id, stmt: insert } = insertItemStmt(req.auth.campaignId, itemInput(req.body ?? {}, false))
    await db.run(insert.sql, insert.args)
    res.status(201).json(toItem(await db.get(SQL.item, [id, req.auth.campaignId])))
  })

  app.post('/items/templates', requireDm, async (req, res) => {
    const campaignId = req.auth.campaignId
    const existing = new Set((await db.all(SQL.items, [campaignId])).map((r) => r.name.toLowerCase()))
    const inserts = CONTAINER_TEMPLATES
      .filter((t) => !existing.has(t.name.toLowerCase()))
      .map((t) => insertItemStmt(campaignId, itemInput({ category: 'pojemnik', ...t, isContainer: true }, false)).stmt)
    if (inserts.length) await db.batch(inserts)
    res.status(201).json({ added: inserts.length })
  })

  app.patch('/items/:id', requireDm, async (req, res) => {
    const campaignId = req.auth.campaignId
    if (!await db.get(SQL.item, [req.params.id, campaignId])) fail(404, 'Nie ma takiego przedmiotu.')
    const data = itemInput(req.body ?? {}, true)
    const u = updates()
    for (const [k, col] of Object.entries(ITEM_COLS)) u.add(col, data[k] === undefined ? undefined : toCol(k, data[k]))
    if (data.isContainer === false) {
      const used = await db.get(`SELECT COUNT(*) AS n FROM entries c JOIN entries p ON c.parent_id = p.id
        WHERE p.item_id = ? AND p.campaign_id = ?`, [req.params.id, campaignId])
      if (used.n) fail(409, 'Ten pojemnik coś zawiera. Najpierw go opróżnij.')
    }
    if (!u.empty) await db.run(u.sql('items', 'id = ?'), [...u.vals, req.params.id])
    res.json(toItem(await db.get(SQL.item, [req.params.id, campaignId])))
  })

  // Deleting a definition in use requires ?force=1 and removes those entries
  // (their contents fall out into the parent container).
  app.delete('/items/:id', requireDm, async (req, res) => {
    const campaignId = req.auth.campaignId
    if (!await db.get(SQL.item, [req.params.id, campaignId])) fail(404, 'Nie ma takiego przedmiotu.')
    const used = await db.all('SELECT id FROM entries WHERE item_id = ? AND campaign_id = ?', [req.params.id, campaignId])
    if (used.length && req.query.force !== '1') {
      fail(409, `Ten przedmiot jest w ekwipunku (${used.length} wpisów). Usunąć mimo to?`, { canForce: true })
    }
    await db.tx(async (t) => {
      for (const e of used) await removeEntry(t, campaignId, e.id)
      await t.run('DELETE FROM items WHERE id = ?', [req.params.id])
    })
    res.status(204).end()
  })

  // inventory
  app.get('/inventory/party', async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    res.json(await inventoryView(campaign, await resolveOwner(campaign.id, 'party')))
  })

  app.get('/inventory/:type/:ownerId', async (req, res) => {
    const owner = await resolveOwner(req.auth.campaignId, req.params.type, req.params.ownerId)
    if (!canAccessOwner(req.auth, owner)) fail(403, 'Nie masz wglądu w ten ekwipunek.')
    res.json(await inventoryView(await getCampaign(req.auth.campaignId), owner))
  })

  // DM gives an item from the catalog to a player or the party stash.
  app.post('/inventory', requireDm, async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    const b = req.body ?? {}
    const owner = await resolveOwner(campaign.id, b.ownerType, b.ownerId)
    const item = await db.get(SQL.item, [b.itemId ?? '', campaign.id])
    if (!item) fail(404, 'Nie ma takiego przedmiotu w katalogu.')
    const quantity = num(b.quantity ?? 1, 'ilość', { min: 1, max: 100000, int: true })
    const parentId = b.parentId || null
    const entry = {
      id: newId(), ownerType: owner.type, ownerId: owner.id, itemId: item.id, quantity,
      parentId, equipped: false, notes: str(b.notes ?? '', 'notatki', { min: 0, max: 500 }), weightOverride: null,
    }
    await db.tx(async (t) => {
      const items = await itemsMap(campaign.id, t)
      checkProblems(req, await placementProblems(campaign, owner, parentId, [entry], items, t))
      await insertOrMerge(t, campaign.id, entry, items)
    })
    res.status(201).json(await inventoryView(campaign, owner))
  })

  async function loadEntry(req) {
    const row = await db.get(SQL.entry, [req.params.id, req.auth.campaignId])
    if (!row) fail(404, 'Nie ma takiego wpisu.')
    const entry = toEntry(row)
    const owner = await resolveOwner(req.auth.campaignId, entry.ownerType, entry.ownerId)
    if (!canAccessOwner(req.auth, owner)) fail(403, 'To nie Twój ekwipunek.')
    return { entry, owner }
  }

  app.patch('/entries/:id', async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    const { entry, owner } = await loadEntry(req)
    const b = req.body ?? {}
    const isDm = req.auth.role === 'dm'
    if (!isDm) {
      const forbidden = Object.keys(b).filter((k) => !['equipped', 'notes'].includes(k))
      if (forbidden.length) fail(403, 'Ilość i wagę zmienia DM.')
    }
    const u = updates()
    const eq = bool(b.equipped, 'założony', { optional: true })
    u.add('equipped', eq === undefined ? undefined : Number(eq))
    u.add('notes', b.notes === undefined ? undefined : str(b.notes, 'notatki', { min: 0, max: 500 }))
    let quantity
    let weightOverride
    if (isDm) {
      quantity = num(b.quantity, 'ilość', { min: 1, max: 100000, int: true, optional: true })
      weightOverride = num(b.weightOverride, 'waga egzemplarza', { min: 0, max: 100000, optional: true, nullable: true })
      u.add('quantity', quantity)
      u.add('weight_override', weightOverride)
    }
    await db.tx(async (t) => {
      if ((quantity !== undefined || weightOverride !== undefined) && entry.parentId) {
        const items = await itemsMap(campaign.id, t)
        const updated = { ...entry, ...(quantity !== undefined && { quantity }), ...(weightOverride !== undefined && { weightOverride }) }
        const moving = (await subtree(campaign.id, entry, t)).map((e) => (e.id === entry.id ? updated : e))
        checkProblems(req, await placementProblems(campaign, owner, entry.parentId, moving, items, t))
      }
      if (!u.empty) await t.run(u.sql('entries', 'id = ?'), [...u.vals, entry.id])
    })
    res.json(await inventoryView(campaign, owner))
  })

  // Move (part of) an entry to another container and/or another owner.
  // Players may only move between their own inventory and the party stash.
  app.post('/entries/:id/move', async (req, res) => {
    const campaign = await getCampaign(req.auth.campaignId)
    const { entry } = await loadEntry(req)
    const b = req.body ?? {}
    const targetType = b.ownerType ?? entry.ownerType
    const target = await resolveOwner(campaign.id, targetType, targetType === 'party' ? undefined : (b.ownerId ?? entry.ownerId))
    if (!canAccessOwner(req.auth, target)) fail(403, 'Możesz przenosić tylko do swojego ekwipunku albo do skarbca.')
    const parentId = b.parentId || null
    const quantity = num(b.quantity ?? entry.quantity, 'ilość', { min: 1, max: entry.quantity, int: true })
    const splitting = quantity < entry.quantity
    if (!splitting && parentId === entry.parentId && target.type === entry.ownerType && target.id === entry.ownerId) {
      return res.json(await inventoryView(campaign, target))
    }

    await db.tx(async (t) => {
      const items = await itemsMap(campaign.id, t)
      const tree = await subtree(campaign.id, entry, t)
      if (splitting && tree.length > 1) fail(400, 'Nie można podzielić pojemnika z zawartością.')
      const movedRoot = splitting ? { ...entry, id: newId(), quantity, notes: '', equipped: false } : entry
      const moving = [movedRoot, ...tree.slice(1)]
      checkProblems(req, await placementProblems(campaign, target, parentId, moving, items, t))
      if (splitting) {
        await t.run('UPDATE entries SET quantity = quantity - ? WHERE id = ?', [quantity, entry.id])
      } else {
        for (const e of tree.slice(1)) {
          await t.run('UPDATE entries SET owner_type = ?, owner_id = ? WHERE id = ?', [target.type, target.id, e.id])
        }
      }
      await insertOrMerge(t, campaign.id, { ...movedRoot, ownerType: target.type, ownerId: target.id, parentId }, items)
    })
    res.json(await inventoryView(campaign, target))
  })

  app.delete('/entries/:id', requireDm, async (req, res) => {
    const { entry, owner } = await loadEntry(req)
    await db.tx((t) => removeEntry(t, req.auth.campaignId, entry.id))
    res.json(await inventoryView(await getCampaign(req.auth.campaignId), owner))
  })

  // backup
  app.get('/export', requireDm, async (req, res) => {
    const id = req.auth.campaignId
    const c = await db.get(SQL.campaign, [id])
    res.json({
      format: 'dndcompanion-v1',
      exportedAt: new Date().toISOString(),
      campaign: { ...toCampaign(c), dmPasswordHash: c.dm_password_hash, playerPasswordHash: c.player_password_hash },
      players: (await db.all(SQL.players, [id])).map((p) => ({ ...toPlayer(p), passwordHash: p.password_hash })),
      items: (await db.all(SQL.items, [id])).map(toItem),
      entries: (await db.all('SELECT * FROM entries WHERE campaign_id = ?', [id])).map(toEntry),
    })
  })

  // Replaces players, catalog and inventories of the current campaign. IDs are regenerated.
  // Everything is validated first, then written in one atomic batch.
  app.post('/import', requireDm, async (req, res) => {
    const data = req.body ?? {}
    if (data.format !== 'dndcompanion-v1') fail(400, 'To nie jest plik eksportu DnD Companion.')
    const campaignId = req.auth.campaignId
    const players = Array.isArray(data.players) ? data.players : []
    const items = Array.isArray(data.items) ? data.items : []
    const entries = Array.isArray(data.entries) ? data.entries : []

    const stmts = [
      stmt(`DELETE FROM sessions WHERE campaign_id = ? AND role = 'player'`, [campaignId]),
      stmt('DELETE FROM entries WHERE campaign_id = ?', [campaignId]),
      stmt('DELETE FROM items WHERE campaign_id = ?', [campaignId]),
      stmt('DELETE FROM players WHERE campaign_id = ?', [campaignId]),
    ]
    const playerIds = new Map()
    const names = new Set()
    for (const p of players) {
      const id = newId()
      playerIds.set(p.id, id)
      const name = str(p.name, 'imię postaci', { max: 60 })
      if (names.has(name.toLowerCase())) fail(400, `Powtórzone imię postaci: ${name}.`)
      names.add(name.toLowerCase())
      stmts.push(stmt(`INSERT INTO players (id, campaign_id, name, password_hash, strength, size, powerful_build, capacity_modifier, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        id, campaignId, name, String(p.passwordHash ?? hashPassword(newToken())),
        num(p.strength ?? 10, 'SIŁ', { min: 1, max: 30, int: true }), oneOf(p.size ?? 'medium', 'rozmiar', SIZE_ORDER),
        Number(!!p.powerfulBuild), num(p.capacityModifier ?? 1, 'mnożnik udźwigu', { min: 0, max: 100 }), Date.now(),
      ]))
    }
    const itemIds = new Map()
    for (const it of items) {
      const { id, stmt: insert } = insertItemStmt(campaignId, itemInput(it, false))
      itemIds.set(it.id, id)
      stmts.push(insert)
    }
    const entryIds = new Map(entries.map((e) => [e.id, newId()]))
    const inserted = new Map() // old id -> { newId, ownerId }
    // parents first so every parent_id points at an already inserted row
    const pending = [...entries]
    let guard = pending.length + 1
    while (pending.length && guard-- > 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const e = pending[i]
        if (e.parentId && pending.some((p) => p.id === e.parentId)) continue
        pending.splice(i, 1)
        const ownerType = e.ownerType === 'party' ? 'party' : 'player'
        const ownerId = ownerType === 'party' ? campaignId : playerIds.get(e.ownerId)
        if (!ownerId || !itemIds.get(e.itemId)) continue
        // a parent that was skipped or belongs to someone else -> carried directly
        const parent = e.parentId ? inserted.get(e.parentId) : null
        inserted.set(e.id, { newId: entryIds.get(e.id), ownerId })
        stmts.push(stmt(SQL.insertEntry, entryRow(campaignId, {
          id: entryIds.get(e.id), ownerType, ownerId, itemId: itemIds.get(e.itemId),
          quantity: num(e.quantity ?? 1, 'ilość', { min: 1, max: 100000, int: true }),
          parentId: parent && parent.ownerId === ownerId ? parent.newId : null,
          equipped: !!e.equipped, notes: String(e.notes ?? '').slice(0, 500),
          weightOverride: e.weightOverride == null ? null : num(e.weightOverride, 'waga egzemplarza', { min: 0, max: 100000 }),
        })))
      }
    }
    if (pending.length) fail(400, 'Plik zawiera cykl w pojemnikach.')
    await db.batch(stmts)
    res.json({ players: players.length, items: items.length, entries: entries.length })
  })

  // errors
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra })
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Niepoprawny JSON.' })
    console.error(err)
    res.status(500).json({ error: 'Błąd serwera.' })
  })

  return { app, db }
}
