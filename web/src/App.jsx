import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { api, isSlow, loadSession, saveSession, setToken, subscribeSlow } from './api.js'
import { Filigree, Quiet } from './ui.jsx'
import Landing from './Landing.jsx'
import CampaignView from './CampaignView.jsx'

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [me, setMe] = useState(null)
  const [error, setError] = useState(null)
  const [justCreated, setJustCreated] = useState(false)
  const slow = useSyncExternalStore(subscribeSlow, isSlow)

  const signIn = useCallback((res, { created = false } = {}) => {
    const s = { token: res.token, role: res.role }
    setToken(s.token)
    saveSession(s)
    setSession(s)
    setJustCreated(created)
  }, [])

  const signOut = useCallback(async () => {
    try { await api('POST', '/auth/logout') } catch { /* session may already be gone */ }
    setToken(null)
    saveSession(null)
    setSession(null)
    setMe(null)
  }, [])

  const reloadMe = useCallback(async () => {
    try {
      setMe(await api('GET', '/me'))
      setError(null)
    } catch (err) {
      if (err.status === 401) {
        setToken(null)
        saveSession(null)
        setSession(null)
        setMe(null)
      } else {
        setError(err.message)
      }
    }
  }, [])

  useEffect(() => {
    if (session) reloadMe()
  }, [session, reloadMe])

  const bg = `${import.meta.env.BASE_URL}background.webp`

  return (
    <div className="dc-wrapper">
      <div className="dc-background" style={{ backgroundImage: `url(${bg})` }} />
      <div className="dc-aura" />
      <div className="dc-content">
        <header className="dc-head">
          <div className="dc-eyebrow"><span className="rune">&#10022;</span>Księga ekwipunku drużyny</div>
          <div className="dc-head-row">
            <h1>{me?.campaign?.name ?? 'DnD Companion'}</h1>
            {me && (
              <div className="dc-session">
                <span>{me.role === 'dm' ? 'Mistrz Gry' : me.player?.name}</span>
                {me.role === 'dm' && <span>Kod: <strong>{me.campaign.joinCode}</strong></span>}
                <Quiet onClick={signOut}>Wyloguj</Quiet>
              </div>
            )}
          </div>
          <Filigree />
          {!session && (
            <p className="dc-lede">
              Kto co dźwiga, ile waży plecak i czy krasnolud jeszcze da radę wnieść skrzynię po schodach.
            </p>
          )}
        </header>

        {!session && <Landing onSignedIn={signIn} />}
        {session && !me && !error && <p className="dc-muted">Wczytywanie kampanii…</p>}
        {session && !me && error && (
          <div className="dc-form">
            <div className="dc-error">{error}</div>
            <div><Quiet onClick={reloadMe}>Spróbuj ponownie</Quiet> <Quiet onClick={signOut}>Wyloguj</Quiet></div>
          </div>
        )}
        {me && (
          <CampaignView
            me={me}
            onMeChanged={reloadMe}
            justCreated={justCreated}
            onDismissCreated={() => setJustCreated(false)}
          />
        )}
      </div>
      {slow && <div className="dc-wake">Budzenie serwera… darmowy hosting usypia po bezczynności, to może potrwać do minuty.</div>}
    </div>
  )
}
