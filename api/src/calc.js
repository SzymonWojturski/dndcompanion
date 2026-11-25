// Weight, carrying capacity and encumbrance rules (D&D 5e, PHB).
// All weights are in pounds.

export const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']
const SIZE_MULTIPLIER = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }

export const MAX_DEPTH = 3

// Powerful Build counts as one size larger for carrying capacity.
export function sizeMultiplier(size, powerfulBuild) {
  let idx = SIZE_ORDER.indexOf(size)
  if (idx < 0) idx = SIZE_ORDER.indexOf('medium')
  if (powerfulBuild) idx = Math.min(idx + 1, SIZE_ORDER.length - 1)
  // Small and Medium share a multiplier, so Powerful Build on a Small creature gives Medium (x1).
  return SIZE_MULTIPLIER[SIZE_ORDER[idx]]
}

export function capacityFor(player) {
  const mult = sizeMultiplier(player.size, player.powerfulBuild) * (player.capacityModifier ?? 1)
  const str = player.strength
  return {
    capacity: str * 15 * mult,
    pushDragLift: str * 30 * mult,
    encumberedAt: str * 5 * mult,
    heavilyEncumberedAt: str * 10 * mult,
  }
}

// Returns { state, speedPenalty, notes } for the given total weight.
export function encumbrance(totalWeight, player, mode) {
  const c = capacityFor(player)
  if (mode === 'variant') {
    if (totalWeight > c.capacity) {
      return { state: 'over', speedPenalty: null, notes: 'Przekroczony udźwig: prędkość 5 ft.' }
    }
    if (totalWeight > c.heavilyEncumberedAt) {
      return {
        state: 'heavy',
        speedPenalty: 20,
        notes: 'Mocno obciążony: prędkość −20 ft, utrudnienie w testach cech, atakach i rzutach obronnych na SIŁ, ZRĘ i KON.',
      }
    }
    if (totalWeight > c.encumberedAt) {
      return { state: 'encumbered', speedPenalty: 10, notes: 'Obciążony: prędkość −10 ft.' }
    }
    return { state: 'ok', speedPenalty: 0, notes: '' }
  }
  if (totalWeight > c.capacity) {
    return { state: 'over', speedPenalty: null, notes: 'Przekroczony udźwig.' }
  }
  return { state: 'ok', speedPenalty: 0, notes: '' }
}

// Builds the inventory tree for one owner and computes weights.
// entries: [{ id, itemId, quantity, parentId, weightOverride, ... }]
// items: Map(itemId -> item)
export function buildTree(entries, items) {
  const nodes = new Map()
  for (const e of entries) {
    nodes.set(e.id, { ...e, item: items.get(e.itemId) ?? null, children: [] })
  }
  const roots = []
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : null
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const visit = (n, seen) => {
    if (seen.has(n.id)) throw new Error(`cycle at entry ${n.id}`)
    seen.add(n.id)
    const item = n.item ?? { weight: 0, size: null, isContainer: false, contentsMultiplier: 1 }
    n.unitWeight = n.weightOverride ?? item.weight
    let contentsWeight = 0
    let contentsSize = 0
    for (const ch of n.children) {
      visit(ch, seen)
      contentsWeight += ch.totalWeight
      contentsSize += ch.ownSize
    }
    const mult = item.isContainer ? (item.contentsMultiplier ?? 1) : 1
    n.contentsWeight = round(contentsWeight)
    n.contentsSize = round(contentsSize)
    n.ownSize = item.size == null ? 0 : item.size * n.quantity
    n.totalWeight = round(n.unitWeight * n.quantity + contentsWeight * mult)
    n.children.sort(byName)
  }
  for (const r of roots) visit(r, new Set())
  roots.sort(byName)
  const totalWeight = round(roots.reduce((a, r) => a + r.totalWeight, 0))
  return { roots, totalWeight, nodes }
}

const byName = (a, b) => (a.item?.name ?? '').localeCompare(b.item?.name ?? '', 'pl')

export const round = (x) => Math.round(x * 1000) / 1000
