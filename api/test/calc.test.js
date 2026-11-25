import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTree, capacityFor, encumbrance, sizeMultiplier } from '../src/calc.js'

const medium = { strength: 10, size: 'medium', powerfulBuild: false, capacityModifier: 1 }

test('capacity is STR x 15 for a medium creature', () => {
  const c = capacityFor(medium)
  assert.equal(c.capacity, 150)
  assert.equal(c.pushDragLift, 300)
  assert.equal(c.encumberedAt, 50)
  assert.equal(c.heavilyEncumberedAt, 100)
})

test('size multipliers and Powerful Build', () => {
  assert.equal(sizeMultiplier('tiny', false), 0.5)
  assert.equal(sizeMultiplier('small', false), 1)
  assert.equal(sizeMultiplier('large', false), 2)
  assert.equal(sizeMultiplier('medium', true), 2)
  assert.equal(sizeMultiplier('small', true), 1)
  assert.equal(sizeMultiplier('gargantuan', true), 4)
  assert.equal(capacityFor({ ...medium, strength: 16, powerfulBuild: true }).capacity, 480)
  assert.equal(capacityFor({ ...medium, capacityModifier: 2 }).capacity, 300)
})

test('simple and variant encumbrance thresholds', () => {
  assert.equal(encumbrance(150, medium, 'simple').state, 'ok')
  assert.equal(encumbrance(151, medium, 'simple').state, 'over')
  assert.equal(encumbrance(50, medium, 'variant').state, 'ok')
  assert.equal(encumbrance(51, medium, 'variant').state, 'encumbered')
  assert.equal(encumbrance(101, medium, 'variant').state, 'heavy')
  assert.equal(encumbrance(151, medium, 'variant').state, 'over')
})

test('weights roll up through containers, extradimensional contents count as zero', () => {
  const items = new Map([
    ['pack', { name: 'Plecak', weight: 5, isContainer: true, contentsMultiplier: 1 }],
    ['boh', { name: 'Torba', weight: 15, isContainer: true, contentsMultiplier: 0 }],
    ['rope', { name: 'Lina', weight: 10, size: 0.5 }],
    ['arrow', { name: 'Strzała', weight: 0.05, size: 0.01 }],
  ])
  const entries = [
    { id: 'p', itemId: 'pack', quantity: 1, parentId: null },
    { id: 'r', itemId: 'rope', quantity: 2, parentId: 'p' },
    { id: 'b', itemId: 'boh', quantity: 1, parentId: 'p' },
    { id: 'a', itemId: 'arrow', quantity: 20, parentId: 'b' },
    { id: 'r2', itemId: 'rope', quantity: 1, parentId: 'b', weightOverride: 3 },
  ]
  const t = buildTree(entries, items)
  const bag = t.nodes.get('b')
  assert.equal(bag.contentsWeight, 4)
  assert.equal(bag.totalWeight, 15)
  assert.equal(bag.contentsSize, 0.7)
  const pack = t.nodes.get('p')
  assert.equal(pack.contentsWeight, 35)
  assert.equal(pack.totalWeight, 40)
  assert.equal(t.totalWeight, 40)
})
