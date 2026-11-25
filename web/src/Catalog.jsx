import { useState } from 'react'
import { api } from './api.js'
import { CATEGORY_LABELS, fmtNum, fmtWeight, fromLb, parseNum, toLb } from './format.js'
import { Button, ErrorBox, Field, Input, Quiet } from './ui.jsx'

const numStr = (v, units) => (v == null ? '' : String(+fromLb(v, units).toFixed(3)))
const plain = (v) => (v == null ? '' : String(v))

function ItemForm({ item, categories, units, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({
    name: item?.name ?? '',
    description: item?.description ?? '',
    category: item?.category ?? 'inne',
    weight: numStr(item?.weight ?? 0, units),
    size: plain(item?.size),
    stackable: item?.stackable ?? false,
    isContainer: item?.isContainer ?? false,
    capacityWeight: numStr(item?.capacityWeight, units),
    capacitySize: plain(item?.capacitySize),
    contentsMultiplier: plain(item?.contentsMultiplier ?? 1),
    extradimensional: item?.extradimensional ?? false,
    allowedCategories: item?.allowedCategories ?? [],
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const toggleAllowed = (c) => setF({
    ...f,
    allowedCategories: f.allowedCategories.includes(c) ? f.allowedCategories.filter((x) => x !== c) : [...f.allowedCategories, c],
  })

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const nums = {
      weight: parseNum(f.weight), size: parseNum(f.size), capacityWeight: parseNum(f.capacityWeight),
      capacitySize: parseNum(f.capacitySize), contentsMultiplier: parseNum(f.contentsMultiplier),
    }
    const bad = Object.entries(nums).find(([, v]) => Number.isNaN(v))
    if (bad) return setError('Pola liczbowe muszą zawierać liczby (przecinek albo kropka).')
    const body = {
      name: f.name,
      description: f.description,
      category: f.category,
      weight: toLb(nums.weight ?? 0, units),
      size: nums.size,
      stackable: f.stackable,
      isContainer: f.isContainer,
      capacityWeight: f.isContainer && nums.capacityWeight != null ? toLb(nums.capacityWeight, units) : null,
      capacitySize: f.isContainer ? nums.capacitySize : null,
      contentsMultiplier: f.isContainer ? (nums.contentsMultiplier ?? 1) : 1,
      extradimensional: f.isContainer && f.extradimensional,
      allowedCategories: f.isContainer && f.allowedCategories.length ? f.allowedCategories : null,
    }
    setBusy(true)
    try {
      if (item) await api('PATCH', `/items/${item.id}`, body)
      else await api('POST', '/items', body)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="dc-form" onSubmit={submit}>
      <div className="dc-row">
        <Field label="Nazwa">
          <Input value={f.name} onChange={set('name')} required maxLength={120} />
        </Field>
        <Field label="Kategoria">
          <Input as="select" value={f.category} onChange={set('category')}>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
          </Input>
        </Field>
      </div>
      <div className="dc-row">
        <Field label={`Waga (${units})`}>
          <Input inputMode="decimal" value={f.weight} onChange={set('weight')} required />
        </Field>
        <Field label="Rozmiar (dowolna jednostka)">
          <Input inputMode="decimal" value={f.size} onChange={set('size')} placeholder="puste = nie zajmuje miejsca" />
        </Field>
      </div>
      <Field label="Opis">
        <Input as="textarea" value={f.description} onChange={set('description')} maxLength={2000} />
      </Field>
      <div className="dc-row">
        <label className="dc-check"><input type="checkbox" checked={f.stackable} onChange={set('stackable')} />Liczony w sztukach (łączy się w stosy)</label>
        <label className="dc-check"><input type="checkbox" checked={f.isContainer} onChange={set('isContainer')} />Pojemnik</label>
      </div>

      {f.isContainer && (
        <>
          <div className="dc-row">
            <Field label={`Udźwig pojemnika (${units})`}>
              <Input inputMode="decimal" value={f.capacityWeight} onChange={set('capacityWeight')} placeholder="puste = bez limitu" />
            </Field>
            <Field label="Pojemność (jednostka rozmiaru)">
              <Input inputMode="decimal" value={f.capacitySize} onChange={set('capacitySize')} placeholder="puste = bez limitu" />
            </Field>
          </div>
          <div className="dc-row">
            <Field label="Ile waży zawartość (0–1)">
              <Input inputMode="decimal" value={f.contentsMultiplier} onChange={set('contentsMultiplier')} />
            </Field>
            <label className="dc-check">
              <input type="checkbox" checked={f.extradimensional} onChange={set('extradimensional')} />
              Przestrzeń pozawymiarowa
            </label>
          </div>
          <p className="dc-muted dc-small">
            1 = zawartość waży normalnie, 0 = nic nie waży (Bag of Holding). Pozawymiarowego pojemnika nie da się włożyć do innego pozawymiarowego.
          </p>
          <Field label="Przyjmuje tylko (nic = wszystko)">
            <div className="dc-row">
              {categories.map((c) => (
                <label key={c} className="dc-check dc-shrink">
                  <input type="checkbox" checked={f.allowedCategories.includes(c)} onChange={() => toggleAllowed(c)} />
                  {CATEGORY_LABELS[c] ?? c}
                </label>
              ))}
            </div>
          </Field>
        </>
      )}
      <ErrorBox error={error} />
      <div className="dc-row">
        <Button type="submit" small disabled={busy}>{item ? 'Zapisz' : 'Dodaj do katalogu'}</Button>
        {onCancel && <Quiet className="dc-shrink" onClick={onCancel}>Anuluj</Quiet>}
      </div>
    </form>
  )
}

function CatalogRow({ item, categories, units, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)

  const remove = async () => {
    if (!window.confirm(`Usunąć „${item.name}” z katalogu?`)) return
    try {
      try {
        await api('DELETE', `/items/${item.id}`)
      } catch (err) {
        if (err.status !== 409) throw err
        if (!window.confirm(`${err.message}\nWpisy z ekwipunków zostaną usunięte, a zawartość pojemników wypadnie piętro wyżej.`)) return
        await api('DELETE', `/items/${item.id}?force=1`)
      }
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  const details = [
    fmtWeight(item.weight, units),
    item.size != null && `rozmiar ${fmtNum(item.size)}`,
    item.isContainer && item.capacityWeight != null && `udźwig ${fmtWeight(item.capacityWeight, units)}`,
    item.isContainer && item.capacitySize != null && `pojemność ${fmtNum(item.capacitySize)}`,
    item.isContainer && item.contentsMultiplier !== 1 && `zawartość ×${fmtNum(item.contentsMultiplier)}`,
    item.allowedCategories && `tylko: ${item.allowedCategories.map((c) => CATEGORY_LABELS[c]).join(', ')}`,
    item.usedCount > 0 && `w ekwipunkach: ${item.usedCount}`,
  ].filter(Boolean)

  return (
    <div className="dc-card">
      <div>
        <div className="dc-card-head">
          <span className="dc-card-title">{item.name}</span>
          <span className={`dc-tag${item.category === 'magiczny' ? ' dc-tag--magic' : ''}`}>{CATEGORY_LABELS[item.category]}</span>
          {item.extradimensional && <span className="dc-tag dc-tag--magic">pozawymiarowy</span>}
          {item.stackable && <span className="dc-tag">sztuki</span>}
        </div>
        <div className="dc-entry-meta">{details.join(' · ')}</div>
        {item.description && !editing && <div className="dc-entry-meta">{item.description}</div>}
        <div className="dc-entry-actions">
          <Quiet onClick={() => setEditing(!editing)}>{editing ? 'Zamknij' : 'Edytuj'}</Quiet>
          <Quiet danger onClick={remove}>Usuń</Quiet>
        </div>
        <ErrorBox error={error} />
        {editing && (
          <div className="dc-entry-panel">
            <ItemForm item={item} categories={categories} units={units} onSaved={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function Catalog({ items, categories, units, onChanged }) {
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [info, setInfo] = useState(null)
  const shown = items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))

  const addTemplates = async () => {
    try {
      const res = await api('POST', '/items/templates')
      setInfo(res.added ? `Dodano ${res.added} pojemników z 5e.` : 'Wszystkie pojemniki z 5e już są w katalogu.')
      onChanged()
    } catch (err) {
      setInfo(err.message)
    }
  }

  return (
    <div className="dc-form">
      <div className="dc-row">
        <Field label="Szukaj">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="nazwa przedmiotu" />
        </Field>
      </div>
      <div className="dc-row">
        <Button small onClick={() => setAdding(!adding)}>{adding ? 'Zamknij formularz' : 'Nowy przedmiot'}</Button>
        <Button small onClick={addTemplates}>Dodaj pojemniki z 5e</Button>
      </div>
      {info && <div className="dc-info">{info}</div>}
      {adding && (
        <div className="dc-card"><div>
          <ItemForm categories={categories} units={units} onSaved={() => { setAdding(false); onChanged() }} onCancel={() => setAdding(false)} />
        </div></div>
      )}
      <div className="dc-list">
        {shown.length === 0 && <p className="dc-muted">Brak przedmiotów.</p>}
        {shown.map((i) => <CatalogRow key={i.id} item={i} categories={categories} units={units} onChanged={onChanged} />)}
      </div>
    </div>
  )
}
