import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { SIZE_LABELS, fmtNum, fmtWeight, parseNum, toLb, fromLb } from './format.js'
import { Button, EncumbranceBar, ErrorBox, Field, Filigree, Input, Panel, Quiet, Stat } from './ui.jsx'
import Inventory from './Inventory.jsx'
import Catalog from './Catalog.jsx'

const POLL_MS = 10_000

// Loads everything the current role may see and refreshes it every 10 s.
function useCampaignData(me) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      let next
      if (me.role === 'dm') {
        const [players, party, items] = await Promise.all([
          api('GET', '/players'), api('GET', '/inventory/party'), api('GET', '/items'),
        ])
        const inventories = await Promise.all(players.map((p) => api('GET', `/inventory/player/${p.id}`)))
        next = { players, party, items, inventories }
      } else {
        const [mine, party] = await Promise.all([
          api('GET', `/inventory/player/${me.player.id}`), api('GET', '/inventory/party'),
        ])
        next = { mine, party }
      }
      if (my === seq.current) { setData(next); setError(null) }
    } catch (err) {
      if (my === seq.current) setError(err.message)
    }
  }, [me.role, me.player?.id])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  return { data, error, reload: load }
}

function StrengthInput({ player, onSaved }) {
  const [value, setValue] = useState(String(player.strength))
  const [error, setError] = useState(null)
  useEffect(() => setValue(String(player.strength)), [player.strength])
  const save = async () => {
    const n = Number(value)
    if (n === player.strength) return
    try {
      await api('PATCH', `/players/${player.id}`, { strength: n })
      setError(null)
      onSaved()
    } catch (err) {
      setError(err.message)
      setValue(String(player.strength))
    }
  }
  return (
    <>
      <input
        className="dc-stat-value"
        type="number"
        min={1}
        max={30}
        value={value}
        aria-label="Siła"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      {error && <div className="dc-entry-meta">{error}</div>}
    </>
  )
}

function CharacterSheet({ player, units, mode, onSaved }) {
  return (
    <>
      <div className="dc-stats">
        <Stat label="Siła"><StrengthInput player={player} onSaved={onSaved} /></Stat>
        <Stat label="Udźwig"><div className="dc-stat-value">{fmtWeight(player.capacity, units)}</div></Stat>
        <Stat label="Niesie"><div className="dc-stat-value">{fmtWeight(player.totalWeight, units)}</div></Stat>
        <Stat label="Pchanie / podnoszenie"><div className="dc-stat-value">{fmtWeight(player.pushDragLift, units)}</div></Stat>
      </div>
      <EncumbranceBar player={player} units={units} mode={mode} />
      <div className="dc-entry-meta">
        {SIZE_LABELS[player.size]}
        {player.powerfulBuild && ' · Potężna budowa'}
        {player.capacityModifier !== 1 && ` · mnożnik udźwigu ×${fmtNum(player.capacityModifier)}`}
      </div>
    </>
  )
}

function PartyHeader({ view, units }) {
  const cap = view.partyCapacity
  return (
    <div className="dc-bar-caption" style={{ marginBottom: 12 }}>
      <span>Razem: {fmtWeight(view.totalWeight, units)}{cap != null && ` / ${fmtWeight(cap, units)}`}</span>
    </div>
  )
}

function PlayerView({ me, data, reload }) {
  const { units, encumbranceMode } = me.campaign
  const destinations = [data.mine, data.party]
  return (
    <div className="dc-grid">
      <Panel title="Twój ekwipunek" extra={data.mine.player.name}>
        <CharacterSheet player={data.mine.player} units={units} mode={encumbranceMode} onSaved={reload} />
        <Filigree divider />
        <Inventory view={data.mine} role="player" units={units} destinations={destinations} onChanged={reload} />
      </Panel>
      <Panel title="Wspólny skarbiec">
        <PartyHeader view={data.party} units={units} />
        <Inventory view={data.party} role="player" units={units} destinations={destinations} onChanged={reload} />
      </Panel>
    </div>
  )
}

function PlayerAdmin({ player, onChanged }) {
  const [f, setF] = useState({
    name: player.name, size: player.size, powerfulBuild: player.powerfulBuild,
    capacityModifier: String(player.capacityModifier), password: '',
  })
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const save = async () => {
    setError(null)
    setMsg(null)
    const mod = parseNum(f.capacityModifier)
    if (mod == null || Number.isNaN(mod)) return setError('Mnożnik musi być liczbą.')
    try {
      await api('PATCH', `/players/${player.id}`, {
        name: f.name, size: f.size, powerfulBuild: f.powerfulBuild, capacityModifier: mod,
        ...(f.password && { password: f.password }),
      })
      setMsg(f.password ? 'Zapisano. Nowe hasło postaci działa, stare sesje gracza wylogowane.' : 'Zapisano.')
      setF({ ...f, password: '' })
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }
  const remove = async () => {
    if (!window.confirm(`Usunąć postać ${player.name}? Jej ekwipunek trafi do wspólnego skarbca.`)) return
    try {
      await api('DELETE', `/players/${player.id}`)
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="dc-form">
      <div className="dc-row">
        <Field label="Imię">
          <Input value={f.name} onChange={set('name')} maxLength={60} />
        </Field>
        <Field label="Rozmiar">
          <Input as="select" value={f.size} onChange={set('size')}>
            {Object.entries(SIZE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Input>
        </Field>
      </div>
      <div className="dc-row">
        <Field label="Mnożnik udźwigu">
          <Input inputMode="decimal" value={f.capacityModifier} onChange={set('capacityModifier')} />
        </Field>
        <Field label="Nowe hasło postaci">
          <Input type="password" value={f.password} onChange={set('password')} placeholder="zostaw puste" autoComplete="new-password" />
        </Field>
      </div>
      <label className="dc-check">
        <input type="checkbox" checked={f.powerfulBuild} onChange={set('powerfulBuild')} />
        Potężna budowa (Powerful Build: liczy się jako rozmiar większy)
      </label>
      <ErrorBox error={error} />
      {msg && <div className="dc-info">{msg}</div>}
      <div className="dc-row">
        <Button small onClick={save}>Zapisz postać</Button>
        <Quiet danger className="dc-shrink" onClick={remove}>Usuń postać</Quiet>
      </div>
    </div>
  )
}

function DmPlayers({ me, data, reload }) {
  const { units, encumbranceMode } = me.campaign
  const [openId, setOpenId] = useState(null)
  const [adminId, setAdminId] = useState(null)
  const destinations = [...data.inventories, data.party]
  if (!data.players.length) {
    return (
      <Panel title="Drużyna">
        <p className="dc-muted">
          Nikt jeszcze nie dołączył. Przekaż graczom kod <strong className="dc-state">{me.campaign.joinCode}</strong> i hasło kampanii.
        </p>
      </Panel>
    )
  }
  return (
    <div className="dc-stack">
      {data.players.map((p, idx) => {
        const view = data.inventories[idx]
        const open = openId === p.id
        return (
          <Panel key={p.id} title={p.name} extra={`SIŁ ${p.strength}`}>
            {!open && <EncumbranceBar player={view.player} units={units} mode={encumbranceMode} />}
            <div className="dc-entry-actions">
              <Quiet onClick={() => setOpenId(open ? null : p.id)}>{open ? 'Zwiń ekwipunek' : 'Pokaż ekwipunek'}</Quiet>
              <Quiet onClick={() => setAdminId(adminId === p.id ? null : p.id)}>{adminId === p.id ? 'Zamknij' : 'Ustawienia postaci'}</Quiet>
            </div>
            {adminId === p.id && (
              <div className="dc-entry-panel"><PlayerAdmin key={p.id} player={p} onChanged={reload} /></div>
            )}
            {open && (
              <>
                <Filigree divider />
                <CharacterSheet player={view.player} units={units} mode={encumbranceMode} onSaved={reload} />
                <Filigree divider />
                <Inventory view={view} role="dm" units={units} destinations={destinations} catalog={data.items} onChanged={reload} />
              </>
            )}
          </Panel>
        )
      })}
    </div>
  )
}

function Settings({ me, onMeChanged, reload }) {
  const c = me.campaign
  const [f, setF] = useState({
    name: c.name, units: c.units, encumbranceMode: c.encumbranceMode,
    partyCapacity: c.partyCapacity == null ? '' : String(+fromLb(c.partyCapacity, c.units).toFixed(2)),
    dmPassword: '', playerPassword: '',
  })
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    setError(null)
    setMsg(null)
    const cap = parseNum(f.partyCapacity)
    if (Number.isNaN(cap)) return setError('Udźwig skarbca musi być liczbą.')
    try {
      await api('PATCH', '/campaign', {
        name: f.name, units: f.units, encumbranceMode: f.encumbranceMode,
        // the capacity field is typed in the units chosen in this form
        partyCapacity: cap == null ? null : toLb(cap, f.units),
        ...(f.dmPassword && { dmPassword: f.dmPassword }),
        ...(f.playerPassword && { playerPassword: f.playerPassword }),
      })
      setF({ ...f, dmPassword: '', playerPassword: '' })
      setMsg('Zapisano.')
      await onMeChanged()
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const exportJson = async () => {
    try {
      const dump = await api('GET', '/export')
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${c.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (err) {
      setError(err.message)
    }
  }

  const importJson = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!window.confirm('Import zastąpi wszystkie postacie, katalog i ekwipunki tej kampanii. Kontynuować?')) return
    try {
      const res = await api('POST', '/import', JSON.parse(await file.text()))
      setMsg(`Zaimportowano: ${res.players} postaci, ${res.items} przedmiotów, ${res.entries} wpisów.`)
      reload()
    } catch (err) {
      setError(err instanceof SyntaxError ? 'To nie jest poprawny plik JSON.' : err.message)
    }
  }

  return (
    <div className="dc-grid">
      <Panel title="Kampania">
        <div className="dc-form">
          <Field label="Nazwa">
            <Input value={f.name} onChange={set('name')} maxLength={80} />
          </Field>
          <div className="dc-row">
            <Field label="Jednostki">
              <Input as="select" value={f.units} onChange={set('units')}>
                <option value="lb">funty (lb)</option>
                <option value="kg">kilogramy (kg)</option>
              </Input>
            </Field>
            <Field label="Obciążenie">
              <Input as="select" value={f.encumbranceMode} onChange={set('encumbranceMode')}>
                <option value="simple">proste (SIŁ × 15)</option>
                <option value="variant">wariantowe (progi SIŁ × 5 i × 10)</option>
              </Input>
            </Field>
          </div>
          <Field label={`Limit wagi skarbca (${f.units})`}>
            <Input inputMode="decimal" value={f.partyCapacity} onChange={set('partyCapacity')} placeholder="puste = bez limitu (np. wóz: 600 lb)" />
          </Field>
          <div className="dc-row">
            <Field label="Nowe hasło DM">
              <Input type="password" value={f.dmPassword} onChange={set('dmPassword')} placeholder="zostaw puste" autoComplete="new-password" />
            </Field>
            <Field label="Nowe hasło kampanii">
              <Input value={f.playerPassword} onChange={set('playerPassword')} placeholder="zostaw puste" autoComplete="off" />
            </Field>
          </div>
          <p className="dc-muted dc-small">Hasło kampanii służy tylko do tworzenia nowych postaci. Zmiana nie wylogowuje graczy.</p>
          <ErrorBox error={error} />
          {msg && <div className="dc-info">{msg}</div>}
          <Button small onClick={save}>Zapisz ustawienia</Button>
        </div>
      </Panel>
      <Panel title="Dołączanie i kopia zapasowa">
        <div className="dc-form">
          <div>
            <div className="dc-field"><span>Kod kampanii</span></div>
            <div className="dc-code">{c.joinCode}</div>
          </div>
          <p className="dc-muted dc-small">Gracze wybierają „Nowa postać”, wpisują ten kod i hasło kampanii.</p>
          <Filigree divider />
          <p className="dc-muted dc-small">
            Dane są trzymane trwale w bazie. Eksport to dodatkowa kopia na wszelki wypadek, np. przed dużymi zmianami.
          </p>
          <div className="dc-row">
            <Button small onClick={exportJson}>Eksportuj JSON</Button>
            <Button small onClick={() => fileRef.current?.click()}>Importuj JSON</Button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
        </div>
      </Panel>
    </div>
  )
}

const DM_TABS = [
  { key: 'players', label: 'Drużyna' },
  { key: 'party', label: 'Skarbiec' },
  { key: 'catalog', label: 'Katalog' },
  { key: 'settings', label: 'Ustawienia' },
]

function DmView({ me, data, reload, onMeChanged }) {
  const [tab, setTab] = useState('players')
  const { units } = me.campaign
  const overloaded = data.players.filter((p) => p.encumbrance.state !== 'ok')
  return (
    <>
      <div className="dc-tabs">
        {DM_TABS.map((t) => (
          <button key={t.key} type="button" className={`dc-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'players' && overloaded.length > 0 && <span className="dc-state dc-state--over"> ({overloaded.length}!)</span>}
          </button>
        ))}
      </div>
      {tab === 'players' && <DmPlayers me={me} data={data} reload={reload} />}
      {tab === 'party' && (
        <Panel title="Wspólny skarbiec">
          <PartyHeader view={data.party} units={units} />
          <Inventory view={data.party} role="dm" units={units} destinations={[...data.inventories, data.party]} catalog={data.items} onChanged={reload} />
        </Panel>
      )}
      {tab === 'catalog' && (
        <Panel title="Katalog przedmiotów" extra={`${data.items.length}`}>
          <Catalog items={data.items} categories={me.categories} units={units} onChanged={reload} />
        </Panel>
      )}
      {tab === 'settings' && <Settings me={me} onMeChanged={onMeChanged} reload={reload} />}
    </>
  )
}

export default function CampaignView({ me, onMeChanged, justCreated, onDismissCreated }) {
  const { data, error, reload } = useCampaignData(me)
  return (
    <>
      {justCreated && (
        <div className="dc-info" style={{ marginBottom: 18 }}>
          Kampania utworzona. Kod dla graczy: <strong className="dc-state">{me.campaign.joinCode}</strong>. Przekaż go razem z hasłem kampanii.{' '}
          <Quiet onClick={onDismissCreated}>OK</Quiet>
        </div>
      )}
      {error && !data && <div className="dc-error">{error} <Quiet onClick={reload}>Spróbuj ponownie</Quiet></div>}
      {!data && !error && <p className="dc-muted">Wczytywanie…</p>}
      {data && me.role === 'dm' && <DmView me={me} data={data} reload={reload} onMeChanged={onMeChanged} />}
      {data && me.role === 'player' && <PlayerView me={me} data={data} reload={reload} />}
    </>
  )
}
