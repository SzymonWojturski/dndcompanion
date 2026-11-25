import { useMemo, useState } from 'react'
import { api } from './api.js'
import { CATEGORY_LABELS, containerTargets, fmtNum, fmtWeight, fromLb, parseNum, toLb } from './format.js'
import { Button, ErrorBox, Field, Input, Quiet } from './ui.jsx'

// Runs an API call; on 409 the DM is offered to force it.
export async function withForce(role, call) {
  try {
    return await call(false)
  } catch (err) {
    if (err.status === 409 && err.body?.canForce && role === 'dm') {
      const problems = err.body.problems?.join('\n') || err.message
      if (window.confirm(`${problems}\n\nWymusić mimo to?`)) return call(true)
      return null
    }
    throw err
  }
}

const ownerKey = (o) => `${o.type}:${o.id}`

function MovePanel({ node, view, destinations, role, onDone, onCancel }) {
  const here = `${ownerKey(view.owner)}:${node.parentId ?? ''}`
  const options = useMemo(() => destinations.map((d) => ({
    owner: d.owner,
    targets: [
      { value: `${ownerKey(d.owner)}:`, label: `${d.owner.name}: luzem` },
      ...containerTargets(d.roots, node.id).map((t) => ({
        value: `${ownerKey(d.owner)}:${t.id}`,
        label: `${d.owner.name}: ${t.label}`,
      })),
    ],
  })), [destinations, node.id])
  const first = options.flatMap((o) => o.targets).find((t) => t.value !== here)
  const [target, setTarget] = useState(first?.value ?? '')
  const [qty, setQty] = useState(String(node.quantity))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const [ownerType, ownerId, parentId] = target.split(':')
    setBusy(true)
    setError(null)
    try {
      const res = await withForce(role, (force) => api('POST', `/entries/${node.id}/move`, {
        ownerType, ownerId, parentId: parentId || null, quantity: Number(qty), force,
      }))
      if (res) onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dc-entry-panel dc-form">
      <div className="dc-row">
        <Field label="Dokąd">
          <Input as="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => (
              <optgroup key={ownerKey(o.owner)} label={o.owner.name}>
                {o.targets.map((t) => (
                  <option key={t.value} value={t.value} disabled={t.value === here}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </Input>
        </Field>
        {node.quantity > 1 && (
          <Field label={`Ile (z ${node.quantity})`}>
            <Input type="number" min={1} max={node.quantity} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="dc-row">
        <Button small onClick={submit} disabled={busy || !target}>Przenieś</Button>
        <Quiet className="dc-shrink" onClick={onCancel}>Anuluj</Quiet>
      </div>
    </div>
  )
}

function EditPanel({ node, role, units, onDone, onCancel }) {
  const isDm = role === 'dm'
  const [f, setF] = useState({
    quantity: String(node.quantity),
    notes: node.notes,
    weightOverride: node.weightOverride == null ? '' : String(fmtNum(fromLb(node.weightOverride, units))).replace(/\s/g, ''),
  })
  const [error, setError] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async () => {
    setError(null)
    const body = { notes: f.notes }
    if (isDm) {
      body.quantity = Number(f.quantity)
      const w = parseNum(f.weightOverride)
      if (Number.isNaN(w)) return setError('Waga musi być liczbą.')
      body.weightOverride = w == null ? null : toLb(w, units)
    }
    try {
      const res = await withForce(role, (force) => api('PATCH', `/entries/${node.id}`, { ...body, force }))
      if (res) onDone()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="dc-entry-panel dc-form">
      {isDm && (
        <div className="dc-row">
          <Field label="Ilość">
            <Input type="number" min={1} value={f.quantity} onChange={set('quantity')} />
          </Field>
          <Field label={`Waga sztuki (${units}), puste = z katalogu`}>
            <Input inputMode="decimal" value={f.weightOverride} onChange={set('weightOverride')} placeholder={fmtNum(fromLb(node.item.weight, units))} />
          </Field>
        </div>
      )}
      <Field label="Notatka">
        <Input value={f.notes} onChange={set('notes')} maxLength={500} placeholder="np. zaklęta, mokra, od kowala z Phandalin" />
      </Field>
      <ErrorBox error={error} />
      <div className="dc-row">
        <Button small onClick={submit}>Zapisz</Button>
        <Quiet className="dc-shrink" onClick={onCancel}>Anuluj</Quiet>
      </div>
    </div>
  )
}

function CapacityInfo({ node, units }) {
  const { item } = node
  const parts = []
  let ratio = 0
  if (item.capacityWeight != null) {
    parts.push(`${fmtWeight(node.contentsWeight, units)} / ${fmtWeight(item.capacityWeight, units)}`)
    ratio = Math.max(ratio, item.capacityWeight ? node.contentsWeight / item.capacityWeight : 1)
  } else if (node.children.length) {
    parts.push(`zawartość ${fmtWeight(node.contentsWeight, units)}`)
  }
  if (item.capacitySize != null) {
    parts.push(`miejsce ${fmtNum(node.contentsSize)} / ${fmtNum(item.capacitySize)}`)
    ratio = Math.max(ratio, item.capacitySize ? node.contentsSize / item.capacitySize : 1)
  }
  if (item.contentsMultiplier === 0) parts.push('zawartość nic nie waży')
  else if (item.contentsMultiplier !== 1) parts.push(`liczy się ${fmtNum(item.contentsMultiplier * 100)}% zawartości`)
  if (!parts.length) return null
  const showBar = item.capacityWeight != null || item.capacitySize != null
  return (
    <>
      <div className="dc-entry-meta">{parts.join(' · ')}</div>
      {showBar && (
        <div className={`dc-capbar${ratio >= 1 ? ' is-full' : ''}`}>
          <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
    </>
  )
}

function EntryNode({ node, ctx }) {
  const { role, units, onChanged } = ctx
  const [open, setOpen] = useState(true)
  const [panel, setPanel] = useState(null)
  const [error, setError] = useState(null)
  const { item } = node
  const isContainer = item.isContainer

  const toggleEquipped = async () => {
    try {
      await api('PATCH', `/entries/${node.id}`, { equipped: !node.equipped })
      onChanged()
    } catch (err) { setError(err.message) }
  }
  const remove = async () => {
    const extra = node.children.length ? ' Zawartość wypadnie piętro wyżej.' : ''
    if (!window.confirm(`Usunąć „${item.name}” z ekwipunku?${extra}`)) return
    try {
      await api('DELETE', `/entries/${node.id}`)
      onChanged()
    } catch (err) { setError(err.message) }
  }
  const done = () => { setPanel(null); onChanged() }

  return (
    <div className={`dc-entry${isContainer ? ' dc-entry--container' : ''}`}>
      <div className="dc-entry-inner">
        <div className="dc-entry-top">
          {isContainer && node.children.length > 0 && (
            <button type="button" className="dc-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Zwiń' : 'Rozwiń'}>
              {open ? '▾' : '▸'}
            </button>
          )}
          <span className="dc-entry-name">
            {node.quantity > 1 && <span className="dc-qty">{node.quantity}×</span>}
            {item.name}
          </span>
          {item.extradimensional && <span className="dc-tag dc-tag--magic">pozawymiarowy</span>}
          {item.category !== 'inne' && item.category !== 'pojemnik' && (
            <span className={`dc-tag${item.category === 'magiczny' ? ' dc-tag--magic' : ''}`}>{CATEGORY_LABELS[item.category]}</span>
          )}
          {node.equipped && <span className="dc-tag">założone</span>}
          <span className="dc-entry-weight" title="Waga liczona do udźwigu">{fmtWeight(node.totalWeight, units)}</span>
        </div>
        {node.quantity > 1 && (
          <div className="dc-entry-meta">{fmtWeight(node.unitWeight, units)} / szt.{node.weightOverride != null && ' (waga ustawiona przez DM)'}</div>
        )}
        {node.quantity === 1 && node.weightOverride != null && <div className="dc-entry-meta">waga ustawiona przez DM</div>}
        {isContainer && <CapacityInfo node={node} units={units} />}
        {node.notes && <div className="dc-entry-meta">„{node.notes}”</div>}
        {item.description && panel === 'info' && <div className="dc-entry-meta">{item.description}</div>}

        <div className="dc-entry-actions">
          <Quiet onClick={() => setPanel(panel === 'move' ? null : 'move')}>Przenieś</Quiet>
          <Quiet onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>{role === 'dm' ? 'Edytuj' : 'Notatka'}</Quiet>
          {ctx.view.owner.type === 'player' && (
            <Quiet onClick={toggleEquipped}>{node.equipped ? 'Zdejmij' : 'Załóż'}</Quiet>
          )}
          {item.description && <Quiet onClick={() => setPanel(panel === 'info' ? null : 'info')}>Opis</Quiet>}
          {role === 'dm' && <Quiet danger onClick={remove}>Usuń</Quiet>}
        </div>
        <ErrorBox error={error} />
        {panel === 'move' && (
          <MovePanel node={node} view={ctx.view} destinations={ctx.destinations} role={role} onDone={done} onCancel={() => setPanel(null)} />
        )}
        {panel === 'edit' && <EditPanel node={node} role={role} units={units} onDone={done} onCancel={() => setPanel(null)} />}

        {isContainer && open && node.children.length > 0 && (
          <div className="dc-children">
            {node.children.map((ch) => <EntryNode key={ch.id} node={{ ...ch, parentId: node.id }} ctx={ctx} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function GiveForm({ view, catalog, units, onChanged }) {
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('1')
  const [parentId, setParentId] = useState('')
  const [filter, setFilter] = useState('')
  const [error, setError] = useState(null)
  const containers = containerTargets(view.roots)
  const shown = catalog.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))

  const submit = async () => {
    setError(null)
    try {
      const res = await withForce('dm', (force) => api('POST', '/inventory', {
        ownerType: view.owner.type, ownerId: view.owner.id, itemId, quantity: Number(qty), parentId: parentId || null, force,
      }))
      if (res) { setQty('1'); onChanged() }
    } catch (err) {
      setError(err.message)
    }
  }

  if (!catalog.length) return <p className="dc-muted dc-small">Katalog jest pusty. Dodaj przedmioty w zakładce Katalog.</p>
  return (
    <div className="dc-form">
      <div className="dc-row">
        <Field label="Szukaj w katalogu">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="np. lina" />
        </Field>
        <Field label="Przedmiot">
          <Input as="select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">— wybierz —</option>
            {shown.map((i) => <option key={i.id} value={i.id}>{i.name} ({fmtWeight(i.weight, units)})</option>)}
          </Input>
        </Field>
      </div>
      <div className="dc-row">
        <Field label="Ilość">
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Gdzie">
          <Input as="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">luzem</option>
            {containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Input>
        </Field>
      </div>
      <ErrorBox error={error} />
      <Button small onClick={submit} disabled={!itemId}>Dodaj do ekwipunku</Button>
    </div>
  )
}

// One owner's inventory: tree + (for the DM) a form to give items from the catalog.
export default function Inventory({ view, role, units, destinations, catalog, onChanged }) {
  const [giving, setGiving] = useState(false)
  const ctx = { role, units, onChanged, view, destinations }
  return (
    <div>
      {view.roots.length === 0 ? (
        <p className="dc-muted">Pusto. Nic tu nie leży.</p>
      ) : (
        <div className="dc-tree">
          {view.roots.map((n) => <EntryNode key={n.id} node={{ ...n, parentId: null }} ctx={ctx} />)}
        </div>
      )}
      {role === 'dm' && (
        <div style={{ marginTop: 16 }}>
          {giving ? (
            <>
              <GiveForm view={view} catalog={catalog} units={units} onChanged={onChanged} />
              <Quiet onClick={() => setGiving(false)}>Zamknij</Quiet>
            </>
          ) : (
            <Quiet onClick={() => setGiving(true)}>+ Dodaj przedmiot z katalogu</Quiet>
          )}
        </div>
      )}
    </div>
  )
}
