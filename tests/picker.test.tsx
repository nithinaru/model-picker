import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

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
    scroll: { offset: 0, bodyRows: 30 },
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
  expect(modelKeyFor('claude-opus-4-8')).toBe('opus-4-8')
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

// At 60 body columns a cell is 6 wide: column c starts at 2 + 13 + 6c, and
// model row r is drawn on screen row 5 + 2r.
const cellAt = (row: number, col: number) => ({ x: 2 + 13 + 6 * col + 3, y: 5 + 2 * row })

const start = async (
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
) => {
  const sent: { model: string; effort: unknown }[] = []
  mock.store(on)
  on('command.register', () => ({ value: { command: 'model-picker' } }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort })

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: null,
    }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const step = async () => {
    const stream = $.turn.step({
      turnId: 't1',
      index: sent.length,
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      messageCount: 1,
    })
    for await (const _ of stream) void 0
    await stream.result

    return sent.at(-1)
  }

  return { step }
}

test('nothing is rewritten before the grid is touched', async ($, on) => {
  const { step } = await start($, on)

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
})

test('a click on a cell changes what the session actually sends', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Opus 5.5 is the first row, Max the sixth column.
  await ui.pointer({ type: 'down', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(0, 5), button: 'left' })

  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  await ui.unmount()
})

test('a drag lands where the pointer lets go, pulled back into the row', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Press on Opus 5.5 / Low, drag to Sonnet 5.5 / Max: Sonnet stops at High.
  await ui.pointer({ type: 'down', ...cellAt(0, 1), button: 'left' })
  await ui.pointer({ type: 'move', ...cellAt(1, 3), button: 'left' })
  await ui.pointer({ type: 'move', ...cellAt(2, 5), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(2, 5), button: 'left' })

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  await ui.unmount()
})

test('the arrow keys move the dot', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The dot starts on the session's Sonnet 5.5; up twice is Opus 5.5.
  await ui.key({ key: 'up' })
  await ui.key({ key: 'up' })
  await ui.key({ key: 'right' })

  expect((await step())?.model).toBe('claude-opus-5-5')
  await ui.unmount()
})

test('older models stay folded until More models is clicked', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeUndefined()
  // Four rows in the open, so the More models line is on screen row 5 + 2 * 4.
  await ui.pointer({ type: 'down', x: 6, y: 13, button: 'left' })
  await ui.pointer({ type: 'up', x: 6, y: 13, button: 'left' })

  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeDefined()
  await ui.unmount()
})
