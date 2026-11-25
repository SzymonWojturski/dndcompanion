import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'

// Each test gets its own SQLite file (same libsql client that talks to Turso in production).
async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'dndcompanion-test-'))
  const { app, db } = await createApp({ dbUrl: `file:${join(dir, 'test.db')}` })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return { call, close: () => { server.close(); db.close(); rmSync(dir, { recursive: true, force: true }) } }
}

// Shared setup: campaign + DM + two players + a small catalog.
async function setup(call) {
  let r = await call('POST', '/campaigns', { name: 'Klątwa', dmPassword: 'dmsecret', playerPassword: 'gracze' })
  assert.equal(r.status, 201)
  const dm = r.body.token
  const code = r.body.campaign.joinCode
  r = await call('POST', '/auth/join', { joinCode: code, campaignPassword: 'gracze', name: 'Ala', password: 'ala1', strength: 8 })
  const ala = { token: r.body.token, id: r.body.player.id }
  r = await call('POST', '/auth/join', { joinCode: code, campaignPassword: 'gracze', name: 'Bob', password: 'bob1' })
  const bob = { token: r.body.token, id: r.body.player.id }
  await call('POST', '/items/templates', {}, dm)
  const items = (await call('GET', '/items', undefined, dm)).body
  const find = (prefix) => items.find((i) => i.name.startsWith(prefix))
  const mk = async (body) => (await call('POST', '/items', body, dm)).body
  return {
    dm, code, ala, bob,
    pack: find('Plecak'), bag: find('Torba'), haversack: find('Poręczny'), quiver: find('Kołczan (Quiver)'),
    rope: await mk({ name: 'Lina', weight: 10, size: 0.4 }),
    arrow: await mk({ name: 'Strzała', weight: 0.05, category: 'amunicja', stackable: true }),
    anvil: await mk({ name: 'Kowadło', weight: 100 }),
  }
}

const give = (call, s, ownerId, itemId, extra = {}) =>
  call('POST', '/inventory', { ownerType: ownerId ? 'player' : 'party', ownerId, itemId, ...extra }, s.dm)

test('campaign creation and passwords', async (t) => {
  const { call, close } = await start()
  t.after(close)
  let r = await call('POST', '/campaigns', { name: 'K', dmPassword: 'dmsecret', playerPassword: 'gracze' })
  const code = r.body.campaign.joinCode
  assert.match(code, /^[A-Z2-9]{6}$/)
  assert.equal((await call('POST', '/campaigns', { name: 'X', dmPassword: 'same', playerPassword: 'same' })).status, 400)
  assert.equal((await call('POST', '/campaigns', { name: 'X', dmPassword: 'abc', playerPassword: 'abcd' })).status, 400)

  assert.equal((await call('POST', '/auth/dm', { joinCode: code, password: 'gracze' })).status, 401)
  assert.equal((await call('POST', '/auth/dm', { joinCode: code.toLowerCase(), password: 'dmsecret' })).status, 200)
  assert.equal((await call('POST', '/auth/dm', { joinCode: 'ZZZZZZ', password: 'dmsecret' })).status, 404)

  assert.equal((await call('POST', '/auth/join', { joinCode: code, campaignPassword: 'nope', name: 'Ala', password: 'ala1' })).status, 401)
  r = await call('POST', '/auth/join', { joinCode: code, campaignPassword: 'gracze', name: 'Ala', password: 'ala1' })
  assert.equal(r.status, 201)
  assert.equal((await call('POST', '/auth/join', { joinCode: code, campaignPassword: 'gracze', name: 'ala', password: 'x123' })).status, 409)
  assert.equal((await call('POST', '/auth/player', { joinCode: code, name: 'ALA', password: 'ala1' })).status, 200)
  assert.equal((await call('POST', '/auth/player', { joinCode: code, name: 'Ala', password: 'bad' })).status, 401)

  const me = await call('GET', '/me', undefined, r.body.token)
  assert.equal(me.body.role, 'player')
  assert.equal(me.body.player.name, 'Ala')
  assert.equal(me.body.campaign.dmPasswordHash, undefined)

  await call('POST', '/auth/logout', undefined, r.body.token)
  assert.equal((await call('GET', '/me', undefined, r.body.token)).status, 401)
  assert.equal((await call('GET', '/me')).status, 401)
})

test('only the DM manages the catalog and gives items', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  assert.equal((await call('POST', '/items', { name: 'Lina', weight: 10 }, s.ala.token)).status, 403)
  assert.equal((await call('POST', '/inventory', { ownerType: 'player', ownerId: s.ala.id, itemId: s.rope.id }, s.ala.token)).status, 403)
  const r = await give(call, s, s.ala.id, s.rope.id)
  assert.equal(r.status, 201)
  assert.equal((await call('DELETE', `/entries/${r.body.roots[0].id}`, undefined, s.ala.token)).status, 403)
  assert.equal((await call('PATCH', `/entries/${r.body.roots[0].id}`, { quantity: 5 }, s.ala.token)).status, 403)
  assert.equal((await call('PATCH', `/entries/${r.body.roots[0].id}`, { notes: 'mokra' }, s.ala.token)).status, 200)

  // in-use definition needs force to delete
  assert.equal((await call('DELETE', `/items/${s.rope.id}`, undefined, s.dm)).status, 409)
  assert.equal((await call('DELETE', `/items/${s.rope.id}?force=1`, undefined, s.dm)).status, 204)
  assert.equal((await call('GET', `/inventory/player/${s.ala.id}`, undefined, s.ala.token)).body.roots.length, 0)
})

test('visibility: players see only themselves and the party stash', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  assert.equal((await call('GET', `/inventory/player/${s.bob.id}`, undefined, s.ala.token)).status, 403)
  assert.equal((await call('GET', `/inventory/player/${s.ala.id}`, undefined, s.ala.token)).status, 200)
  assert.equal((await call('GET', '/inventory/party', undefined, s.ala.token)).status, 200)
  assert.equal((await call('GET', '/players', undefined, s.ala.token)).body.length, 1)
  assert.equal((await call('GET', '/players', undefined, s.dm)).body.length, 2)
})

test('weights, capacity and container limits', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  let r = await give(call, s, s.ala.id, s.pack.id)
  const packEntry = r.body.roots[0].id
  r = await give(call, s, s.ala.id, s.rope.id, { quantity: 2, parentId: packEntry })
  assert.equal(r.body.totalWeight, 25)
  assert.equal(r.body.player.capacity, 120)

  // 3 x 0.4 cu ft > 1 cu ft
  r = await give(call, s, s.ala.id, s.rope.id, { parentId: packEntry })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /miejsca/)

  // 100 lb anvil > 30 lb backpack; DM can force
  r = await give(call, s, s.ala.id, s.anvil.id, { parentId: packEntry })
  assert.equal(r.status, 409)
  assert.equal(r.body.canForce, true)
  r = await give(call, s, s.ala.id, s.anvil.id, { parentId: packEntry, force: true })
  assert.equal(r.status, 201)
  assert.equal(r.body.totalWeight, 125)
  assert.equal(r.body.player.encumbrance.state, 'over')

  // quiver only takes ammunition
  r = await give(call, s, s.ala.id, s.quiver.id)
  const quiverEntry = r.body.roots.find((n) => n.itemId === s.quiver.id).id
  assert.equal((await give(call, s, s.ala.id, s.rope.id, { parentId: quiverEntry })).status, 409)
  assert.equal((await give(call, s, s.ala.id, s.arrow.id, { parentId: quiverEntry, quantity: 20 })).status, 201)

  // stackable items merge
  r = await give(call, s, s.ala.id, s.arrow.id, { parentId: quiverEntry, quantity: 5 })
  const q = r.body.roots.find((n) => n.id === quiverEntry)
  assert.equal(q.children.length, 1)
  assert.equal(q.children[0].quantity, 25)

  // variant encumbrance
  await call('PATCH', '/campaign', { encumbranceMode: 'variant' }, s.dm)
  r = await call('GET', `/inventory/player/${s.ala.id}`, undefined, s.dm)
  assert.equal(r.body.player.encumbrance.state, 'over')
})

test('extradimensional nesting and depth are blocked', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  let r = await give(call, s, s.ala.id, s.bag.id)
  const bagEntry = r.body.roots[0].id
  r = await give(call, s, s.ala.id, s.haversack.id, { parentId: bagEntry })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /pozawymiarow/)

  // depth: pack > pack > pack > pack is 3 containers above the last one: ok; one more: blocked
  r = await give(call, s, null, s.pack.id)
  let parent = r.body.roots[0].id
  for (let i = 0; i < 3; i++) {
    r = await give(call, s, null, s.pack.id, { parentId: parent, force: true })
    assert.equal(r.status, 201)
    const flat = []
    const walk = (n) => { flat.push(n); n.children.forEach(walk) }
    r.body.roots.forEach(walk)
    parent = flat.find((n) => n.children.length === 0).id
  }
  r = await give(call, s, null, s.rope.id, { parentId: parent })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /zagnieżdżenie/)
})

test('players move items only between themselves and the party stash', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  let r = await give(call, s, s.ala.id, s.pack.id)
  const packEntry = r.body.roots[0].id
  r = await give(call, s, s.ala.id, s.rope.id, { quantity: 2, parentId: packEntry })
  const ropeEntry = r.body.roots[0].children[0].id

  // split one rope out to the party stash
  r = await call('POST', `/entries/${ropeEntry}/move`, { ownerType: 'party', parentId: null, quantity: 1 }, s.ala.token)
  assert.equal(r.status, 200)
  assert.equal(r.body.owner.type, 'party')
  const partyRope = r.body.roots[0].id
  r = await call('GET', `/inventory/player/${s.ala.id}`, undefined, s.ala.token)
  assert.equal(r.body.roots[0].children[0].quantity, 1)

  // Bob cannot touch Ala's things, cannot give to Ala, can take from party
  assert.equal((await call('POST', `/entries/${ropeEntry}/move`, { ownerType: 'party' }, s.bob.token)).status, 403)
  assert.equal((await call('POST', `/entries/${partyRope}/move`, { ownerType: 'player', ownerId: s.ala.id }, s.bob.token)).status, 403)
  r = await call('POST', `/entries/${partyRope}/move`, { ownerType: 'player', ownerId: s.bob.id }, s.bob.token)
  assert.equal(r.status, 200)
  assert.equal(r.body.totalWeight, 10)

  // whole container moves with its contents
  r = await call('POST', `/entries/${packEntry}/move`, { ownerType: 'party' }, s.ala.token)
  assert.equal(r.body.totalWeight, 15)
  assert.equal(r.body.roots[0].children.length, 1)
  assert.equal((await call('GET', `/inventory/player/${s.ala.id}`, undefined, s.ala.token)).body.totalWeight, 0)

  // container cannot go inside itself
  r = await give(call, s, s.bob.id, s.pack.id)
  const bobPack = r.body.roots.find((n) => n.itemId === s.pack.id).id
  r = await give(call, s, s.bob.id, s.bag.id, { parentId: bobPack })
  const bobBag = r.body.roots.find((n) => n.id === bobPack).children[0].id
  assert.equal((await call('POST', `/entries/${bobPack}/move`, { parentId: bobBag }, s.bob.token)).status, 400)
})

test('player stats: player edits only strength, DM edits the rest', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  let r = await call('PATCH', `/players/${s.ala.id}`, { strength: 12 }, s.ala.token)
  assert.equal(r.body.capacity, 180)
  assert.equal((await call('PATCH', `/players/${s.ala.id}`, { size: 'large' }, s.ala.token)).status, 403)
  assert.equal((await call('PATCH', `/players/${s.bob.id}`, { strength: 12 }, s.ala.token)).status, 403)
  assert.equal((await call('PATCH', `/players/${s.ala.id}`, { strength: 31 }, s.ala.token)).status, 400)
  r = await call('PATCH', `/players/${s.ala.id}`, { size: 'medium', powerfulBuild: true, capacityModifier: 1.5 }, s.dm)
  assert.equal(r.body.capacity, 540)

  // password reset logs the player out
  await call('PATCH', `/players/${s.ala.id}`, { password: 'nowe1' }, s.dm)
  assert.equal((await call('GET', '/me', undefined, s.ala.token)).status, 401)

  // deleting a character moves their stuff to the party stash
  await give(call, s, s.bob.id, s.rope.id)
  assert.equal((await call('DELETE', `/players/${s.bob.id}`, undefined, s.dm)).status, 204)
  assert.equal((await call('GET', '/inventory/party', undefined, s.dm)).body.totalWeight, 10)
})

test('export and import round-trip', async (t) => {
  const { call, close } = await start()
  t.after(close)
  const s = await setup(call)
  let r = await give(call, s, s.ala.id, s.pack.id)
  await give(call, s, s.ala.id, s.rope.id, { parentId: r.body.roots[0].id })
  await give(call, s, null, s.anvil.id)
  const dump = (await call('GET', '/export', undefined, s.dm)).body
  assert.equal(dump.format, 'dndcompanion-v1')

  r = await call('POST', '/import', dump, s.dm)
  assert.equal(r.status, 200)
  const players = (await call('GET', '/players', undefined, s.dm)).body
  const ala = players.find((p) => p.name === 'Ala')
  assert.equal(ala.totalWeight, 15)
  assert.equal((await call('GET', '/inventory/party', undefined, s.dm)).body.totalWeight, 100)
  // player passwords survive, old player sessions do not
  assert.equal((await call('GET', '/me', undefined, s.ala.token)).status, 401)
  assert.equal((await call('POST', '/auth/player', { joinCode: s.code, name: 'Ala', password: 'ala1' })).status, 200)
})
