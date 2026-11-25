export const LB_TO_KG = 0.45359237

export function fmtWeight(lb, units) {
  if (lb == null) return '—'
  const v = units === 'kg' ? lb * LB_TO_KG : lb
  return `${fmtNum(v)} ${units === 'kg' ? 'kg' : 'lb'}`
}

export const fmtNum = (v) =>
  Number(v).toLocaleString('pl-PL', { maximumFractionDigits: 2 })

// Weight typed by the user in display units -> pounds.
export const toLb = (value, units) => (units === 'kg' ? value / LB_TO_KG : value)
export const fromLb = (lb, units) => (units === 'kg' ? lb * LB_TO_KG : lb)

export const parseNum = (s) => {
  if (s === '' || s == null) return null
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export const CATEGORY_LABELS = {
  bron: 'Broń',
  zbroja: 'Zbroja',
  amunicja: 'Amunicja',
  sprzet: 'Sprzęt',
  mikstura: 'Mikstura',
  magiczny: 'Magiczny',
  pojemnik: 'Pojemnik',
  inne: 'Inne',
}

export const SIZE_LABELS = {
  tiny: 'Drobny (Tiny)',
  small: 'Mały (Small)',
  medium: 'Średni (Medium)',
  large: 'Duży (Large)',
  huge: 'Wielki (Huge)',
  gargantuan: 'Ogromny (Gargantuan)',
}

export const STATE_LABELS = {
  ok: 'W normie',
  encumbered: 'Obciążony',
  heavy: 'Mocno obciążony',
  over: 'Przeciążony',
}

// Flattens a tree into container destinations, skipping `excludeId` and its subtree.
export function containerTargets(roots, excludeId) {
  const out = []
  const walk = (nodes, depth, path) => {
    for (const n of nodes) {
      if (n.id === excludeId) continue
      if (n.item?.isContainer) {
        out.push({ id: n.id, label: [...path, n.item.name].join(' › '), depth })
        walk(n.children, depth + 1, [...path, n.item.name])
      }
    }
  }
  walk(roots, 0, [])
  return out
}
