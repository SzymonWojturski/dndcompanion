import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'

async function boot(dbUrl) {
  const { app, db } = await createApp({ dbUrl })
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
  const stop = async () => { await new Promise((r) => server.close(r)); db.close() }
  return { call, stop }
}

test('data survives an API restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dndcompanion-persist-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dbUrl = `file:${join(dir, 'db.sqlite')}`

  let api = await boot(dbUrl)
  let r = await api.call('POST', '/campaigns', { name: 'Trwała', dmPassword: 'dmsecret', playerPassword: 'gracze' })
  const { joinCode } = r.body.campaign
  const dm = r.body.token
  r = await api.call('POST', '/auth/join', { joinCode, campaignPassword: 'gracze', name: 'Ala', password: 'ala1' })
  const alaId = r.body.player.id
  const rope = (await api.call('POST', '/items', { name: 'Lina', weight: 10 }, dm)).body
  await api.call('POST', '/inventory', { ownerType: 'player', ownerId: alaId, itemId: rope.id }, dm)
  await api.stop()

  api = await boot(dbUrl)
  t.after(api.stop)
  r = await api.call('POST', '/auth/player', { joinCode, name: 'Ala', password: 'ala1' })
  assert.equal(r.status, 200)
  r = await api.call('GET', `/inventory/player/${alaId}`, undefined, r.body.token)
  assert.equal(r.body.totalWeight, 10)
  assert.equal((await api.call('GET', '/me', undefined, dm)).body.role, 'dm')
})

test('deleted character can no longer use its session', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dndcompanion-persist-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const api = await boot(`file:${join(dir, 'db.sqlite')}`)
  t.after(api.stop)
  let r = await api.call('POST', '/campaigns', { name: 'K', dmPassword: 'dmsecret', playerPassword: 'gracze' })
  const dm = r.body.token
  r = await api.call('POST', '/auth/join', { joinCode: r.body.campaign.joinCode, campaignPassword: 'gracze', name: 'Bob', password: 'bob1' })
  const bob = r.body
  assert.equal((await api.call('DELETE', `/players/${bob.player.id}`, undefined, dm)).status, 204)
  assert.equal((await api.call('GET', '/me', undefined, bob.token)).status, 401)
})
