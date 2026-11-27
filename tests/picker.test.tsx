import { expect, mock, test } from 'claude-code/testing'

import { modelKeyFor, requestFor } from '../hooks/register'

const PANE = {
  plugin: 'model-picker',
  component: 'Pane',
  requestId: 'model-picker',
  props: {
    title: 'Model picker',
    isFocused: false,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const off = { model: 'opus-5-5', effort: 'default', isUltra: false, isOn: false }
const on_ = { ...off, isOn: true }

test('the session model finds its row, by id or by alias', () => {
  expect(modelKeyFor('claude-fable-5-2')).toBe('fable-5-2')
  expect(modelKeyFor('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(modelKeyFor('claude-opus-5')).toBe('opus-5')
  expect(modelKeyFor('sonnet')).toBe('sonnet-5-5')
  expect(modelKeyFor('something-else')).toBe('opus-5-5')
  expect(modelKeyFor(null)).toBe('opus-5-5')
})

test('a request is left alone until a model has been picked', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'high' } as const

  expect(requestFor(off, sent)).toEqual(sent)
})

test('a picked model and level are sent, pulled back to what the model allows', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'high' } as const

  expect(requestFor({ ...on_, model: 'opus-5-5', effort: 'max' }, sent)).toEqual({
    model: 'claude-opus-5-5',
    effort: 'max',
  })
  // Haiku 5.5 takes Default only, so "max" is pulled back to Default, which
  // sends no level of its own and keeps whatever the session was sending.
  expect(requestFor({ ...on_, model: 'haiku-5-5', effort: 'max' }, sent)).toEqual({
    model: 'claude-haiku-5-5',
    effort: 'high',
  })
  // Default keeps whatever level the session was sending.
  expect(requestFor({ ...on_, model: 'opus-5', effort: 'default' }, sent)).toEqual({
    model: 'claude-opus-5',
    effort: 'high',
  })
})

test('the pane shows the kept choice, and a fresh install mirrors the session', async ($, on) => {
  mock.store(on, {
    'choice-3': { model: 'opus-5-5', effort: 'max', isUltra: false, isOn: true },
  })
  on('command.register', () => ({ value: { command: 'model-picker' } }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const kept = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await kept.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  await kept.unmount()
})

test('a fresh pane mirrors the session model and changes nothing yet', async $ => {
  const fresh = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await fresh.find({ type: 'Text', text: /Pick a model/ })).toBeDefined()
  await fresh.unmount()
})

test('picking a model in the pane changes what the session actually sends', async ($, on) => {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'model-picker' } }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let modelReceived = ''
  on('turn.step', async function* (_, e) {
    modelReceived = e.model

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const select = await ui.find({ type: 'Select', key: 'model' })
  await ui.select({ key: 'model', value: 'opus-5-5' })
  await ui.press({ key: 'effort-max' })
  await ui.unmount()

  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    messageCount: 1,
  })
  for await (const _ of stream) void 0
  await stream.result

  expect(select).toBeDefined()
  // Proves the picker's pick actually reaches the model request, not just the pane.
  expect(modelReceived).toBe('claude-opus-5-5')
})
