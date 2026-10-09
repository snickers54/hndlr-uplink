import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPanel, heatRatio, heatBar, heatColor, activeOps, HEAT_MAX } from '../hooks/panel.js'

// Fake element constructors — buildPanel only passes props through, so plain
// object tags let tests walk the tree like the surface renderer would.
const Box = (props) => ({ kind: 'Box', ...props })
const Text = (props) => ({ kind: 'Text', ...props })
const Button = (props) => ({ kind: 'Button', ...props })
const el = { Box, Text, Button }

const baseData = {
  state: {
    player: {
      username: 'S4B3R', archetype: 'STEALTH', subscription_tier: 'GHOST',
      crypto: 12432100, dirty_crypto: 340, fragments: 1204, echoes: 56,
      reputation: 5210, heat: 22,
    },
    heat_lockout: { threshold: 200, locked: false },
    vault: { cap: 10000000, protected: 8100000, exposed: 0, mining_halted: false },
  },
  notif: {
    unread_count: 1,
    notifications: [
      { id: 'n1', severity: 'danger', title: 'Heat lockout started', read_at: null, created_at: new Date(Date.now() - 60_000).toISOString() },
      { id: 'n2', severity: 'info', title: 'Raid repelled', read_at: '2026-10-09T00:00:00Z', created_at: new Date(Date.now() - 3600_000).toISOString() },
    ],
  },
  botnet: { total_nodes: 48, aggregate_health: 81, critical_count: 3, offline_count: 2 },
  wire: { items: [
    { id: 'w1', headline: 'NEXUS breach contained, says CORP', occurredAt: new Date(Date.now() - 7200_000).toISOString(), pinned: true },
    { id: 'w2', headline: 'DarkNet chatter spikes in sector 7', occurredAt: new Date(Date.now() - 300_000).toISOString() },
  ] },
  updatedAt: Date.parse('2026-10-09T12:03:00Z'),
}

function texts(tree, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (tree.kind === 'Text') out.push(tree)
  for (const c of tree.children || []) texts(c, out)
  return out
}

test('heat helpers scale against the lockout threshold', () => {
  assert.equal(HEAT_MAX, 200)
  assert.equal(heatRatio(100, 200), 0.5)
  assert.equal(heatRatio(400, 200), 1) // clamped, never over
  assert.equal(heatRatio(undefined, undefined), 0)
  assert.equal(heatBar(100, 200, 10), '█████░░░░░')
  assert.equal(heatBar(0, 200, 4), '░░░░')
  assert.equal(heatColor(50, 200), 'green')
  assert.equal(heatColor(120, 200), 'yellow')
  assert.equal(heatColor(200, 200), 'red')
})

test('panel renders the operator identity line', () => {
  const t = texts(buildPanel(el, baseData, 44))
  const line = t.find((x) => (x.children || []).join('').includes('S4B3R · STEALTH · GHOST'))
  assert.ok(line, 'identity line present')
})

test('heat row colors by ratio and flags lockout', () => {
  const tree = buildPanel(el, baseData, 44)
  const heat = texts(tree).find((x) => (x.children || []).join('').startsWith('22 '))
  assert.ok(heat, 'heat value shown')
  assert.equal(heat.color, 'green')

  const locked = structuredClone(baseData)
  locked.state.player.heat = 220
  locked.state.heat_lockout.locked = true
  const t2 = texts(buildPanel(el, locked, 44))
  assert.ok(t2.some((x) => (x.children || []).join('') === 'LOCKED' && x.color === 'red' && x.bold))
})

test('unread transmissions are bold; read ones are not', () => {
  const t = texts(buildPanel(el, baseData, 44))
  const unread = t.find((x) => (x.children || []).join('').includes('● Heat lockout started'))
  const read = t.find((x) => (x.children || []).join('').includes('Raid repelled'))
  assert.equal(unread.bold, true)
  assert.equal(unread.color, 'red') // danger severity color
  assert.notEqual(read.bold, true)
})

test('botnet trouble line is red when nodes are critical', () => {
  const t = texts(buildPanel(el, baseData, 44))
  const trouble = t.find((x) => (x.children || []).join('').includes('3 critical'))
  assert.ok(trouble)
  assert.equal(trouble.color, 'red')
})

test('sections disappear when their data is missing', () => {
  const partial = { state: baseData.state, notif: { unread_count: 0, notifications: [] } }
  const t = texts(buildPanel(el, partial, 44))
  assert.ok(!t.some((x) => (x.children || []).join('').startsWith('BOTNET')), 'no botnet section')
  assert.ok(!t.some((x) => (x.children || []).join('').startsWith('THE WIRE')), 'no wire section')
  assert.ok(t.some((x) => (x.children || []).join('') === 'the wire is quiet'))
})

test('empty data renders a connecting placeholder, not a crash', () => {
  const t = texts(buildPanel(el, {}, 44))
  assert.ok(t.some((x) => (x.children || []).join('').includes('establishing uplink')))
})

test('wire items show headline + age, pinned in cyan', () => {
  const t = texts(buildPanel(el, baseData, 44))
  const pinned = t.find((x) => (x.children || []).join('').includes('NEXUS breach'))
  assert.equal(pinned.color, 'cyan')
  assert.ok(t.some((x) => (x.children || []).join('') === '5m ago'))
})

test('error line renders in red and controls are buttons', () => {
  const data = { ...baseData, error: 'uplink error — retrying next refresh' }
  const tree = buildPanel(el, data, 44)
  const t = texts(tree)
  assert.ok(t.some((x) => x.color === 'red' && (x.children || []).join('').startsWith('uplink error')))
  const buttons = []
  const walk = (n) => {
    if (n.kind === 'Button') buttons.push(n)
    for (const c of n.children || []) walk(c)
  }
  walk(tree)
  assert.deepEqual(buttons.map((b) => b.hotkey).sort(), ['m', 'r', 'x'])
  assert.ok(buttons.every((b) => typeof b.onPress === 'function'))
})

test('activeOps names boss, siege and event defensively', () => {
  assert.deepEqual(activeOps({}), [])
  assert.deepEqual(
    activeOps({ active_world_boss: { name: 'LEVIATHAN' }, siege_season: {}, active_event: { title: 'Blackout Week' } }),
    ['WORLD BOSS — LEVIATHAN', 'SIEGE SEASON — DESCENT OPEN', 'EVENT — Blackout Week'],
  )
})

test('panel ops section appears only when something is active', () => {
  const quiet = texts(buildPanel(el, baseData, 44))
  assert.ok(!quiet.some((x) => (x.children || []).join('').startsWith('OPERATIONS')))
  const hot = structuredClone(baseData)
  hot.state.active_world_boss = { name: 'LEVIATHAN' }
  const t = texts(buildPanel(el, hot, 44))
  assert.ok(t.some((x) => (x.children || []).join('') === '▲ WORLD BOSS — LEVIATHAN' && x.color === 'magenta'))
})
