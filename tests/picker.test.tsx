import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { captionFor, modelRowFor, requestFor } from '../hooks/register'

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

const off = { model: 'fable-5-2', effort: 'default', isOn: false }
const on_ = { ...off, isOn: true }

// At 60 body columns the effort names take 11 cells and each model column 11.
// Effort rows run from Ultracode (row 0) down to Default (row 6), under one
// line of model names. Columns: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5.
const ROW = { ultracode: 0, max: 1, xhigh: 2, high: 3, medium: 4, low: 5, default: 6 } as const
const cellAt = (row: number, col: number) => ({ x: 11 + 11 * col + 5, y: 1 + row })
const FOOT = 9

test('the session model finds its column, by id or by alias', () => {
  expect(modelRowFor('claude-fable-5-2')).toBe('fable-5-2')
  expect(modelRowFor('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(modelRowFor('claude-opus-5')).toBe('opus-5')
  expect(modelRowFor('sonnet')).toBe('sonnet-5-5')
  expect(modelRowFor('claude-opus-4-8')).toBe('opus-4-8')
  expect(modelRowFor('something-else')).toBeNull()
  expect(modelRowFor(null)).toBeNull()
})

test('a request is left alone until a cell has been picked', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'high' } as const

  expect(requestFor(off, sent)).toEqual(sent)
})

test('a picked model and level are sent, pulled back to what the model allows', () => {
  const sent = { model: 'claude-sonnet-5-5', effort: 'high' } as const

  expect(requestFor({ ...on_, model: 'opus-5-5', effort: 'max' }, sent)).toEqual({
    model: 'claude-opus-5-5',
    effort: 'max',
  })
  // Haiku 5.5 takes Default only, which keeps whatever the session was sending.
  expect(requestFor({ ...on_, model: 'haiku-5-5', effort: 'max' }, sent)).toEqual({
    model: 'claude-haiku-5-5',
    effort: 'high',
  })
})

test('the line under the grid says what the level means and what answered', () => {
  expect(captionFor(off, null)).toContain('Following the session')
  expect(captionFor({ ...on_, effort: 'ultracode' }, null)).toContain('adds the word ultracode')
  expect(captionFor({ ...on_, effort: 'high' }, 'claude-fable-5-2')).toBe('Last answer came from Fable 5.2.')
  expect(captionFor({ ...on_, effort: 'high' }, 'claude-mystery-9')).toBe('Last answer came from claude-mystery-9.')
})

const start = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  const sent: { model: string; effort: unknown }[] = []
  const prompts: string[] = []
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'model-picker' } }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort })

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
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
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const click = async (at: { x: number; y: number }) => {
    await ui.pointer({ type: 'down', ...at, button: 'left' })
    await ui.pointer({ type: 'up', ...at, button: 'left' })
  }

  return { step, prompts, ui, click }
}

test('nothing is rewritten before the grid is touched', async ($, on) => {
  const { step, ui } = await start($, on)

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  await ui.unmount()
})

test('a click on a cell changes what the session actually sends', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click(cellAt(ROW.max, 1))

  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  await ui.unmount()
})

test('Fable 5.2 is the first column', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click(cellAt(ROW.high, 0))

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'high' })
  await ui.unmount()
})

test('a drag lands where the pointer lets go, pulled back to what the model allows', async ($, on) => {
  const { step, ui } = await start($, on)

  // Press on Fable 5.2 at Low, drag up and across to Sonnet 5.5 at Max: Sonnet stops at High.
  await ui.pointer({ type: 'down', ...cellAt(ROW.low, 0), button: 'left' })
  await ui.pointer({ type: 'move', ...cellAt(ROW.high, 1), button: 'left' })
  await ui.pointer({ type: 'move', ...cellAt(ROW.max, 2), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(ROW.max, 2), button: 'left' })

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  await ui.unmount()
})

test('Ultracode is the top row: Max effort, and the word on the prompt', async ($, on) => {
  const { step, prompts, ui, click } = await start($, on)

  await click(cellAt(ROW.ultracode, 0))
  await $.prompt.submit({ text: 'tidy the tests', wait: false, origin: { kind: 'composer' } })

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'max' })
  expect(prompts.at(-1)).toBe('tidy the tests\n\nultracode')
  await ui.unmount()
})

test('a press outside the cells changes nothing', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click({ x: 30, y: 0 }) // a model name
  await click({ x: 30, y: 8 }) // the blank line above the footer

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  await ui.unmount()
})

test('the arrow keys move the dot: up is more effort, left is the model before', async ($, on) => {
  const { step, ui } = await start($, on)

  // The dot starts on the session's Sonnet 5.5 (third column).
  await ui.key({ key: 'left' })
  await ui.key({ key: 'up' })

  expect((await step())?.model).toBe('claude-opus-5-5')
  await ui.unmount()
})

test('More models pages to the older ones, and a pick there is sent', async ($, on) => {
  const { step, ui, click } = await start($, on)

  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeUndefined()
  await click({ x: 3, y: FOOT })
  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeDefined()
  // Second page: Sonnet 5, Opus 5, Fable 5, Opus 4.8.
  await click(cellAt(ROW.high, 1))

  expect(await step()).toEqual({ model: 'claude-opus-5', effort: 'high' })
  await ui.unmount()
})

test('Use session model switches the mod off again', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click(cellAt(ROW.max, 1))
  expect((await step())?.model).toBe('claude-opus-5-5')
  await click({ x: 11 + 44 - 3, y: FOOT })

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  await ui.unmount()
})

test('minimised into the side column, the pane shows the choice at a glance', async ($, on) => {
  const { ui, click } = await start($, on)
  await click(cellAt(ROW.max, 1))
  await ui.unmount()

  const glance = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })
  expect((await glance.find({ type: 'Text', text: /Opus/ }))?.text).toBe('Opus 5.5 · Max')
  await glance.unmount()
})
