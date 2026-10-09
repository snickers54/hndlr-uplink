import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../hooks/register.js'

// Drives the real command routing in register.js through a fake mods-API
// surface ($): store in memory, ui.open/close recorded, no network — the
// command paths under test never need the client.

function makeFake($) {
  const store = new Map()
  const closed = []
  const opened = []
  const f = {
    store: {
      get: async (k) => (store.has(k) ? store.get(k) : undefined),
      set: async (k, v) => { store.set(k, v) },
      delete: async (k) => { store.delete(k) },
    },
    http: { fetch: async () => { throw new Error('network not expected here') } },
    ui: {
      status: () => {},
      toast: () => {},
      close: async (args) => { closed.push(args) },
      open: async (args) => { opened.push(args); return { isPlaced: true } },
      invalidate: () => {},
      resolve: () => ({}),
    },
    clock: { every: () => () => {} },
    command: { register: async () => {} },
    env: { get: async () => null },
    closed, opened, store,
    ...$,
  }
  const handlers = {}
  const on = (event, matcher, fn) => {
    if (typeof matcher === 'function') { fn = matcher; matcher = null }
    handlers[event + (matcher ? ':' + Object.entries(matcher).map(([k, v]) => `${k}=${v}`).join(',') : '')] = fn
  }
  register(on)
  f.runHw = async (args) => {
    const key = Object.keys(handlers).find((k) => k.startsWith('command.run:'))
    const res = await handlers[key](f, { command: 'hw', args })
    return res && res.text !== undefined ? res.text : res
  }
  return f
}

test('/hw close closes the pane and works without a session', async () => {
  const f = makeFake()
  const text = await f.runHw('close')
  assert.deepEqual(f.closed, [{ id: 'hw-panel' }])
  assert.match(text, /panel closed/)
})

test('/hw close is listed in help and the command hint', async () => {
  const f = makeFake()
  const text = await f.runHw('help')
  assert.match(text, /\/hw close/)
  assert.match(text, /ctrl\+x x/)
})

test('ungated commands run before the session gate', async () => {
  // no tokens stored: close/help/api must answer, everything else gates
  const f = makeFake()
  assert.match(await f.runHw('close'), /panel closed/)
  assert.match(await f.runHw('api'), /API base/)
  assert.match(await f.runHw('status'), /No uplink session/)
})
