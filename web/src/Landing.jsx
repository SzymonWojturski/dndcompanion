import { useState } from 'react'
import { api } from './api.js'
import { Button, ErrorBox, Field, Input, Panel } from './ui.jsx'

function useSubmit(fn) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

function CreateCampaign({ onSignedIn }) {
  const [f, setF] = useState({ name: '', dmPassword: '', playerPassword: '', confirm: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const { busy, error, submit } = useSubmit(async () => {
    if (f.dmPassword !== f.confirm) throw new Error('Hasła DM się różnią.')
    const res = await api('POST', '/campaigns', { name: f.name, dmPassword: f.dmPassword, playerPassword: f.playerPassword })
    onSignedIn(res, { created: true })
  })
  return (
    <Panel title="Nowa kampania">
      <form className="dc-form" onSubmit={submit}>
        <Field label="Nazwa kampanii">
          <Input value={f.name} onChange={set('name')} required maxLength={80} placeholder="Klątwa Strahda" />
        </Field>
        <div className="dc-row">
          <Field label="Hasło DM">
            <Input type="password" value={f.dmPassword} onChange={set('dmPassword')} required minLength={4} autoComplete="new-password" />
          </Field>
          <Field label="Powtórz hasło DM">
            <Input type="password" value={f.confirm} onChange={set('confirm')} required minLength={4} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Hasło kampanii (dla graczy)">
          <Input value={f.playerPassword} onChange={set('playerPassword')} required minLength={4} autoComplete="off" />
        </Field>
        <p className="dc-muted dc-small">
          Po utworzeniu dostaniesz kod kampanii. Gracze dołączają kodem i hasłem kampanii, a potem logują się już własnym hasłem postaci.
        </p>
        <ErrorBox error={error} />
        <Button type="submit" block disabled={busy}>
          <span className="dot">&#9670;</span>{busy ? 'Tworzenie…' : 'Utwórz kampanię'}<span className="dot">&#9670;</span>
        </Button>
      </form>
    </Panel>
  )
}

const MODES = [
  { key: 'login', label: 'Gracz' },
  { key: 'join', label: 'Nowa postać' },
  { key: 'dm', label: 'Mistrz Gry' },
]

function EnterCampaign({ onSignedIn }) {
  const [mode, setMode] = useState('login')
  const [f, setF] = useState({ joinCode: '', name: '', password: '', campaignPassword: '', strength: '10' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const { busy, error, submit } = useSubmit(async () => {
    const joinCode = f.joinCode.trim().toUpperCase()
    let res
    if (mode === 'dm') res = await api('POST', '/auth/dm', { joinCode, password: f.password })
    if (mode === 'login') res = await api('POST', '/auth/player', { joinCode, name: f.name, password: f.password })
    if (mode === 'join') {
      res = await api('POST', '/auth/join', {
        joinCode, campaignPassword: f.campaignPassword, name: f.name, password: f.password, strength: Number(f.strength),
      })
    }
    onSignedIn(res)
  })
  return (
    <Panel title="Wejdź do kampanii">
      <div className="dc-tabs">
        {MODES.map((m) => (
          <button key={m.key} type="button" className={`dc-tab${mode === m.key ? ' is-active' : ''}`} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <form className="dc-form" onSubmit={submit}>
        <Field label="Kod kampanii">
          <Input value={f.joinCode} onChange={set('joinCode')} required maxLength={20} placeholder="np. K7M2QX" autoCapitalize="characters" />
        </Field>
        {mode === 'join' && (
          <Field label="Hasło kampanii (od DM)">
            <Input type="password" value={f.campaignPassword} onChange={set('campaignPassword')} required />
          </Field>
        )}
        {mode !== 'dm' && (
          <Field label="Imię postaci">
            <Input value={f.name} onChange={set('name')} required maxLength={60} autoComplete="username" />
          </Field>
        )}
        <Field label={mode === 'dm' ? 'Hasło DM' : mode === 'join' ? 'Twoje hasło postaci (nowe)' : 'Hasło postaci'}>
          <Input
            type="password"
            value={f.password}
            onChange={set('password')}
            required
            minLength={mode === 'join' ? 4 : undefined}
            autoComplete={mode === 'join' ? 'new-password' : 'current-password'}
          />
        </Field>
        {mode === 'join' && (
          <Field label="Siła (SIŁ)">
            <Input type="number" min={1} max={30} value={f.strength} onChange={set('strength')} required />
          </Field>
        )}
        <ErrorBox error={error} />
        <Button type="submit" block disabled={busy}>
          <span className="dot">&#9670;</span>{busy ? 'Chwila…' : mode === 'join' ? 'Dołącz' : 'Zaloguj'}<span className="dot">&#9670;</span>
        </Button>
      </form>
    </Panel>
  )
}

export default function Landing({ onSignedIn }) {
  return (
    <div className="dc-grid dc-grid--landing">
      <EnterCampaign onSignedIn={onSignedIn} />
      <CreateCampaign onSignedIn={onSignedIn} />
    </div>
  )
}
