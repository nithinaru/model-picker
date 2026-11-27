import { expect, mock, test } from 'claude-code/testing'

import { requestFor, rowOfModel, snap } from '../hooks/register'

const PANE = {
  plugin: 'model-picker',
  component: 'Pane',
  requestId: 'model-picker',
  props: {
    title: 'Model picker',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const off = { model: 'auto', effort: 'default', isUltra: false, auto: null, isOn: false }
const on_ = { ...off, isOn: true }

test('the dot is pulled back to the last level a model allows', () => {
  expect(snap(1, 5)).toEqual({ row: 1, col: 5 }) // Opus 5.5 takes Max
  expect(snap(3, 5)).toEqual({ row: 3, col: 3 }) // Sonnet 5.5 stops at High
  expect(snap(4, 3)).toEqual({ row: 4, col: 0 }) // Haiku 5.5 is Default only
  expect(snap(5, 5)).toEqual({ row: 5, col: 4 }) // Opus 5 stops at Extra
  expect(snap(99, -4)).toEqual({ row: 6, col: 0 })
})

test('the session model finds its row, by id or by alias', () => {
  expect(rowOfModel('claude-fable-5-2')).toBe(2)
  expect(rowOfModel('claude-opus-5-5[1m]')).toBe(1)
  expect(rowOfModel('claude-opus-5')).toBe(5)
  expect(rowOfModel('sonnet')).toBe(3)
  expect(rowOfModel('something-else')).toBe(0)
  expect(rowOfModel(null)).toBe(0)
})

test('a request is left alone until the dot has been moved', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'high' } as const

  expect(requestFor({ ...off, model: 'opus-5-5', effort: 'max' }, sent)).toEqual(sent)
})

test('a chosen cell sets the model and the level', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'high' } as const

  expect(requestFor({ ...on_, model: 'opus-5-5', effort: 'max' }, sent)).toEqual({
    model: 'claude-opus-5-5',
    effort: 'max',
  })
  // Default keeps whatever level the session was sending.
  expect(requestFor({ ...on_, model: 'opus-5', effort: 'default' }, sent)).toEqual({
    model: 'claude-opus-5',
    effort: 'high',
  })
  // Ultracode rides on the prompt and leaves the level as chosen.
  expect(requestFor({ ...on_, model: 'fable-5-2', effort: 'medium', isUltra: true }, sent)).toEqual({
    model: 'claude-fable-5-2',
    effort: 'medium',
  })
})

test('Auto sends the model it picked, and no level that model lacks', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'medium' } as const
  const auto = { ...on_, effort: 'max' }

  // Before its first pick Auto keeps the session's model, capped at that model's top level.
  expect(requestFor(auto, sent)).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  expect(requestFor({ ...auto, auto: 'claude-opus-5-5' }, sent)).toEqual({
    model: 'claude-opus-5-5',
    effort: 'max',
  })
  expect(requestFor({ ...auto, auto: 'claude-haiku-5-5' }, sent)).toEqual({
    model: 'claude-haiku-5-5',
    effort: 'medium',
  })
})

test('the pane draws on every surface, with a kept choice', async ($, on) => {
  mock.store(on, {
    'choice-2': { model: 'opus-5-5', effort: 'max', isUltra: false, auto: null, isOn: true },
  })
  on('command.register', () => ({ value: { command: 'model-picker' } }))
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /Drag the dot/ })).toBeDefined()
    await ui.unmount()
  }
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Opus/ }))?.text).toBe('Opus 5.5 · Max')
    await ui.unmount()
  }
})
