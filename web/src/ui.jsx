import { STATE_LABELS, fmtWeight } from './format.js'

export function Bracket({ className }) {
  return (
    <svg className={className} viewBox="0 0 30 30" aria-hidden="true">
      <path d="M1 12 L1 1 L12 1" fill="none" stroke="rgba(243,213,158,.7)" strokeWidth="1.2" />
      <path d="M5 8 L5 5 L8 5" fill="none" stroke="rgba(196,150,255,.6)" strokeWidth="1" />
    </svg>
  )
}

export function Filigree({ divider = false }) {
  return (
    <svg className={`dc-filigree${divider ? ' dc-filigree--divider' : ''}`} viewBox="0 0 300 20" width={divider ? '100%' : 300} height="20" aria-hidden="true">
      <path d="M2 11 L118 11 M182 11 L298 11" fill="none" stroke="rgba(240,208,148,.5)" strokeWidth="1.1" />
      <path d="M150 3 L158 11 L150 19 L142 11 Z" fill="rgba(243,207,130,.8)" />
      <path d="M129 7.5 L132.5 11 L129 14.5 L125.5 11 Z M171 7.5 L174.5 11 L171 14.5 L167.5 11 Z" fill="rgba(240,208,148,.6)" />
    </svg>
  )
}

export function Panel({ title, extra, children }) {
  return (
    <div className="dc-frame">
      <div className="dc-panel">
        <div className="dc-panel-glow" />
        <div className="dc-panel-spark" />
        <Bracket className="dc-bracket dc-bracket--tr" />
        <Bracket className="dc-bracket dc-bracket--bl" />
        <div className="dc-panel-body">
          {title && (
            <div className="dc-label">
              <span className="dot">&#9670;</span>{title}
              {extra && <span className="dc-label-extra">{extra}</span>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="dc-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Input({ as = 'input', ...props }) {
  const Tag = as
  return (
    <div className="dc-input-shell">
      <Tag className="dc-input" {...props} />
    </div>
  )
}

export function Button({ children, small, block, danger, ...props }) {
  return (
    <span className={`dc-btn-frame${block ? ' dc-btn-frame--block' : ''}${danger ? ' dc-btn-frame--danger' : ''}`}>
      <button type="button" className={`dc-btn${small ? ' dc-btn--small' : ''}`} {...props}>
        {children}
      </button>
    </span>
  )
}

export function Quiet({ children, danger, ...props }) {
  return (
    <button type="button" className={`dc-quiet${danger ? ' dc-quiet--danger' : ''}`} {...props}>
      {children}
    </button>
  )
}

export function ErrorBox({ error }) {
  if (!error) return null
  return <div className="dc-error" role="alert">{error}</div>
}

export function Stat({ label, children }) {
  return (
    <div className="dc-stat">
      <div>
        <div className="dc-stat-label">{label}</div>
        {children}
      </div>
    </div>
  )
}

// Carrying-capacity bar; in variant mode, marks the STR×5 and STR×10 thresholds.
export function EncumbranceBar({ player, units, mode }) {
  const { totalWeight, capacity, encumbrance } = player
  const pct = capacity > 0 ? Math.min(100, (totalWeight / capacity) * 100) : 100
  return (
    <div>
      <div className={`dc-bar dc-bar--${encumbrance.state}`}>
        <div className="dc-bar-fill" style={{ width: `${pct}%` }} />
        {mode === 'variant' && (
          <>
            <div className="dc-bar-mark" style={{ left: `${(100 / 3).toFixed(2)}%` }} />
            <div className="dc-bar-mark" style={{ left: `${(200 / 3).toFixed(2)}%` }} />
          </>
        )}
      </div>
      <div className="dc-bar-caption">
        <span>{fmtWeight(totalWeight, units)} / {fmtWeight(capacity, units)}</span>
        <span className={`dc-state dc-state--${encumbrance.state}`}>{STATE_LABELS[encumbrance.state]}</span>
      </div>
      {encumbrance.notes && <div className="dc-entry-meta">{encumbrance.notes}</div>}
    </div>
  )
}
