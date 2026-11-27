import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { captionFor, layoutFor, modelRowFor, requestFor } from '../hooks/register'

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

// Rows are models: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5. Columns are
// effort levels, Default (0) to Max (5) and Ultracode (6). At 60 body columns
// the model names take 9 cells and each column 6; the effort names take two
// lines and a blank one, and each model row two lines.
const COL = { default: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5, ultracode: 6 } as const
const cellAt = (row: number, col: number) => ({ x: 9 + 6 * col + 3, y: 3 + 2 * row })
const FOOT = 11

test('the session model finds its row, by id or by alias', () => {
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

test('effort names are written out in full, on as many lines as the pane needs', () => {
  const names = (columns: number) =>
    layoutFor(columns, 40, 4, false).head.map(line => line.map(slot => slot.label))

  expect(names(80)).toEqual([['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultracode']])
  expect(names(60)).toEqual([
    ['Default', 'Medium', 'Extra high', 'Ultracode'],
    ['Low', 'High', 'Max'],
  ])
  expect(names(38)).toHaveLength(3)
  expect(names(38).flat()).toContain('Extra high')
  // No two names on a line share a cell, at any width a pane can have.
  for (let columns = 26; columns <= 120; columns++) {
    for (const line of layoutFor(columns, 40, 4, false).head) {
      for (const slot of line) expect(slot.lead).toBeGreaterThanOrEqual(0)
    }
  }
})

test('a tall pane spaces the rows out, a short one keeps them together', () => {
  expect(layoutFor(60, 30, 4, false).pitch).toBe(2)
  expect(layoutFor(60, 12, 4, false).pitch).toBe(1)
})

const start = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], columns = 60) => {
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
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'desktop' })
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

  await click(cellAt(1, COL.max))

  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  await ui.unmount()
})

test('Fable 5.2 is the first row', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click(cellAt(0, COL.high))

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'high' })
  await ui.unmount()
})

test('a drag lands where the pointer lets go, pulled back to what the model allows', async ($, on) => {
  const { step, ui } = await start($, on)

  // Press on Fable 5.2 at Low, drag down and across to Sonnet 5.5 at Max: Sonnet stops at High.
  await ui.pointer({ type: 'down', ...cellAt(0, COL.low), button: 'left' })
  await ui.pointer({ type: 'move', ...cellAt(1, COL.high), button: 'left' })
  await ui.pointer({ type: 'move', ...cellAt(2, COL.max), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(2, COL.max), button: 'left' })

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  await ui.unmount()
})

test('the dot can be let go between cells, and settles on the nearest one', async ($, on) => {
  const { step, ui } = await start($, on)

  // The blank line under Fable 5.2, a character into the Extra high column:
  // nearer Opus 5.5 than Fable 5.2 by the half-line rule, in the Extra high column.
  const between = { x: 9 + 6 * COL.xhigh + 1, y: 3 + 1 }
  await ui.pointer({ type: 'down', ...cellAt(0, COL.medium), button: 'left' })
  await ui.pointer({ type: 'move', x: between.x - 4, y: between.y - 1, button: 'left' })
  await ui.pointer({ type: 'move', ...between, button: 'left' })
  await ui.pointer({ type: 'up', ...between, button: 'left' })

  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  await ui.unmount()
})

test('the ember keeps time on its own without disturbing the pick', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click(cellAt(1, COL.max))
  await ui.advance(700)

  expect(await ui.find({ type: 'Text', text: '⬤', in: 'grid' })).toBeDefined()
  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  await ui.unmount()
})

test('Ultracode is the last column: Max effort, and the word on the prompt', async ($, on) => {
  const { step, prompts, ui, click } = await start($, on)

  await click(cellAt(0, COL.ultracode))
  await $.prompt.submit({ text: 'tidy the tests', wait: false, origin: { kind: 'composer' } })

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'max' })
  expect(prompts.at(-1)).toBe('tidy the tests\n\nultracode')
  await ui.unmount()
})

test('a press outside the grid changes nothing', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click({ x: 30, y: 0 }) // an effort name
  await click({ x: 30, y: FOOT - 1 }) // the blank line above the footer

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  await ui.unmount()
})

test('the arrow keys move the dot: up is the model above, right is more effort', async ($, on) => {
  const { step, ui } = await start($, on)

  // The dot starts on the session's Sonnet 5.5, at Default until a request shows its level.
  await ui.key({ key: 'up' })
  await ui.key({ key: 'right' })

  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
  await ui.unmount()
})

test('More models pages to the older ones, and a pick there is sent', async ($, on) => {
  const { step, ui, click } = await start($, on)

  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeUndefined()
  await click({ x: 3, y: FOOT })
  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeDefined()
  // Second page: Sonnet 5, Opus 5, Fable 5, Opus 4.8.
  await click(cellAt(1, COL.high))

  expect(await step()).toEqual({ model: 'claude-opus-5', effort: 'high' })
  await ui.unmount()
})

test('Use session model switches the mod off again', async ($, on) => {
  const { step, ui, click } = await start($, on)

  await click(cellAt(1, COL.max))
  expect((await step())?.model).toBe('claude-opus-5-5')
  await click({ x: 9 + 42 - 3, y: FOOT })

  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  await ui.unmount()
})

test('in a narrow sidebar the names stay whole and a click still lands', async ($, on) => {
  const { step, ui, click } = await start($, on, 38)

  expect(await ui.find({ type: 'Text', text: 'Extra high', in: 'grid' })).toBeDefined()
  // 38 body columns: columns 3 cells wide, three lines of names and a blank one.
  await click({ x: 9 + 3 * COL.max + 1, y: 4 + 2 * 1 })

  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  await ui.unmount()
})

test('minimised into the side column, the pane shows the choice at a glance', async ($, on) => {
  const { ui, click } = await start($, on)
  await click(cellAt(1, COL.max))
  await ui.unmount()

  const glance = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })
  expect((await glance.find({ type: 'Text', text: /Opus/ }))?.text).toBe('Opus 5.5 · Max')
  await glance.unmount()
})
