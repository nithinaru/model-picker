import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { headerFor, rowUnder } from '../hooks/grid'
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

const off = { model: 'opus-5-5', effort: 'default', isOn: false }
const on_ = { ...off, isOn: true }

test('the session model finds its row, by id or by alias', () => {
  expect(modelRowFor('claude-fable-5-2')).toBe('fable-5-2')
  expect(modelRowFor('claude-opus-5-5[1m]')).toBe('opus-5-5')
  expect(modelRowFor('claude-opus-5')).toBe('opus-5')
  expect(modelRowFor('claude-opus-5-20260101')).toBe('opus-5')
  expect(modelRowFor('sonnet')).toBe('sonnet-5-5')
  expect(modelRowFor('opus[1m]')).toBe('opus-5-5')
  expect(modelRowFor('claude-opus-4-8')).toBe('opus-4-8')
})

test('a session model with no row finds none, never a neighbour', () => {
  expect(modelRowFor('something-else')).toBeNull()
  expect(modelRowFor(null)).toBeNull()
  // A version the table does not list is not drawn as the one before it.
  expect(modelRowFor('claude-opus-5-9')).toBeNull()
  expect(modelRowFor('claude-opus-6')).toBeNull()
  expect(modelRowFor('claude-sonnet-6-20270101')).toBeNull()
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

// At 60 body columns a cell is 6 wide and the names take two lines: column c
// starts at 12 + 6c, and model row r is drawn on screen row 3 + 2r. The hint
// line is on screen row 10 and the footer line (More models, Use session
// model) on row 12, the second ending under the last column name at 56.
const cellAt = (row: number, col: number) => ({ x: 12 + 6 * col + 3, y: 3 + 2 * row })
const MORE = { x: 3, y: 12 }
const RESET = { x: 45, y: 12 }
const SESSION = { model: 'claude-sonnet-5-5', effort: 'medium' }

type Setup = { kept?: Record<string, unknown>; session?: { model: string } }

const start = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], setup: Setup = {}) => {
  const sent: { model: string; effort: unknown }[] = []
  const prompts: string[] = []
  // What `/model` says the session is on: a test may move it.
  const session = setup.session ?? { model: 'claude-sonnet-5-5' }
  mock.store(on, setup.kept)
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('command.register', () => ({ value: { command: 'model-picker' } }))
  on('session.model', () => ({ value: session.model }))
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

  return { step, prompts }
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

test('Ultracode is the column after Max: Max effort, and the word on the prompt', async ($, on) => {
  const { step, prompts } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.pointer({ type: 'down', ...cellAt(1, 6), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(1, 6), button: 'left' })
  await $.prompt.submit({ text: 'tidy the tests', wait: false, origin: { kind: 'composer' } })

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'max' })
  expect(prompts.at(-1)).toBe('tidy the tests\n\nultracode')
  // Sonnet 5.5 has no Ultracode: the same column there lands on High.
  await ui.pointer({ type: 'down', ...cellAt(2, 6), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(2, 6), button: 'left' })
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
  await ui.pointer({ type: 'down', ...MORE, button: 'left' })
  await ui.pointer({ type: 'up', ...MORE, button: 'left' })

  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeDefined()
  await ui.unmount()
})

test('a press that is not on a model row changes nothing', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const strays = [
    { x: 27, y: 0 }, // a column name
    { x: 45, y: 1 }, // the word Max
    { x: 30, y: 2 }, // the blank line under the names
    { x: 55, y: 3 }, // the gutter right of Ultracode
    { x: 30, y: 11 }, // the blank line over More models
    { x: 28, y: 12 }, // between the footer's two controls
    { x: 56, y: 12 }, // just past the end of Use session model
    { x: 30, y: 13 }, // under the footer
  ]
  for (const at of strays) {
    await ui.pointer({ type: 'down', ...at, button: 'left' })
    await ui.pointer({ type: 'up', ...at, button: 'left' })
  }
  // A button other than the left one is not a pick either.
  await ui.pointer({ type: 'down', ...cellAt(0, 5), button: 'right' })
  await ui.pointer({ type: 'up', ...cellAt(0, 5), button: 'right' })

  expect(await step()).toEqual(SESSION)
  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeUndefined()
  await ui.unmount()
})

test('a press on a model name moves to that model and keeps the level', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.pointer({ type: 'down', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  await ui.pointer({ type: 'up', x: 5, y: 5, button: 'left' })

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'max' })
  await ui.unmount()
})

test('a pointer position finds the row whose line it is on, whole or finer', () => {
  const rows = [
    { key: 'a', label: 'A', max: 6, isOlder: false },
    { key: 'b', label: 'B', max: 6, isOlder: false },
    { key: 'c', label: 'C', max: 3, isOlder: true },
    { key: 'd', label: 'D', max: 3, isOlder: true },
  ]
  // Drawn from screen row 5: A on 5, B on 7, then C on 9 and D on 10.
  const whole = (y: number) => rowUnder(rows, 5, y, false)
  const fine = (y: number) => rowUnder(rows, 5, y, true)

  expect([4, 5, 6, 7, 8, 9, 10, 11].map(whole)).toEqual([null, 0, 0, 1, 1, 2, 3, null])
  // The middle of a text line is its own row; the blank line between two is split.
  expect(fine(5.5)).toBe(0)
  expect(fine(6.4)).toBe(0)
  expect(fine(6.6)).toBe(1)
  expect(fine(7.5)).toBe(1)
  expect(fine(4.4)).toBeNull()
  // The blank line under the last spaced row is not the older row beneath it.
  expect(fine(8.4)).toBe(1)
  expect(fine(8.7)).toBeNull()
  expect(fine(9.5)).toBe(2)
  expect(fine(10.5)).toBe(3)
  expect(fine(11.2)).toBeNull()
})

test('a press that loses its release is called off', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The release never arrives; the pointer comes back with no button held.
  await ui.pointer({ type: 'down', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'leave', ...cellAt(0, 5) })
  await ui.pointer({ type: 'move', ...cellAt(1, 2) })
  await ui.pointer({ type: 'move', ...cellAt(1, 3) })
  expect(await step()).toEqual(SESSION)
  // More models still answers a click afterwards.
  await ui.pointer({ type: 'down', ...MORE, button: 'left' })
  await ui.pointer({ type: 'up', ...MORE, button: 'left' })
  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeDefined()
  await ui.unmount()
})

test('a drag past the edge goes on, and lands on the nearest cell', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Press Fable 5.2 / High, overshoot the right edge and the region, let go out there.
  await ui.pointer({ type: 'down', ...cellAt(1, 3), button: 'left' })
  await ui.pointer({ type: 'move', x: 58, y: 5, button: 'left' })
  await ui.pointer({ type: 'leave', x: 58, y: 5 })
  await ui.pointer({ type: 'move', x: 70, y: 5, button: 'left' })
  await ui.pointer({ type: 'up', x: 70, y: 5, button: 'left' })
  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'max' })

  // Above the grid and left of it is the first cell.
  await ui.pointer({ type: 'down', ...cellAt(1, 3), button: 'left' })
  await ui.pointer({ type: 'move', x: -4, y: -3, button: 'left' })
  await ui.pointer({ type: 'up', x: -4, y: -3, button: 'left' })
  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
  await ui.unmount()
})

test('across and back ends on the cell of the last press', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.pointer({ type: 'down', ...cellAt(1, 2), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(1, 2), button: 'left' })
  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'medium' })
  await ui.key({ key: 'right' })
  await ui.key({ key: 'left' })

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'medium' })
  await ui.unmount()
})

test('a session on a model with no row gets no dot, and the caption names it', async ($, on) => {
  const session = { model: 'claude-sonnet-5-5' }
  const { step } = await start($, on, { session })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  session.model = 'claude-opus-6'

  // The session moved to another model; Use session model reads it again.
  await ui.pointer({ type: 'down', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'down', ...RESET, button: 'left' })
  await ui.pointer({ type: 'up', ...RESET, button: 'left' })

  expect(await ui.find({ type: 'Text', text: '⬤', in: 'grid' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /claude-opus-6, which has no row/ })).toBeDefined()
  // Enter has no cell to pick; an arrow key starts from the first one.
  await ui.key({ key: 'return' })
  expect(await ui.find({ type: 'Text', text: '⬤', in: 'grid' })).toBeUndefined()
  await ui.key({ key: 'right' })
  expect(await ui.find({ type: 'Text', text: '⬤', in: 'grid' })).toBeDefined()
  expect((await step())?.model).toBe('claude-opus-5-5')
  await ui.unmount()
})

test('a kept choice for a model the table no longer has is dropped', async ($, on) => {
  const { step } = await start($, on, { kept: { 'choice-4': { model: 'opus-3', effort: 'high', isOn: true } } })

  expect(await step()).toEqual(SESSION)
})

test('Use session model hands the choice back, and is only there after a pick', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: 'Use session model', in: 'grid' })).toBeUndefined()
  await ui.pointer({ type: 'down', ...RESET, button: 'left' })
  await ui.pointer({ type: 'up', ...RESET, button: 'left' })
  expect(await step()).toEqual(SESSION)

  await ui.pointer({ type: 'down', ...cellAt(0, 5), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(0, 5), button: 'left' })
  expect(await step()).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
  expect(await ui.find({ type: 'Text', text: 'Use session model', in: 'grid' })).toBeDefined()

  await ui.pointer({ type: 'down', ...RESET, button: 'left' })
  await ui.pointer({ type: 'up', ...RESET, button: 'left' })
  expect(await step()).toEqual(SESSION)
  expect(await ui.find({ type: 'Text', text: 'Use session model', in: 'grid' })).toBeUndefined()
  await ui.unmount()
})

test('up and down carry the level along and bring it back', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.pointer({ type: 'down', ...cellAt(1, 5), button: 'left' })
  await ui.pointer({ type: 'up', ...cellAt(1, 5), button: 'left' })
  await ui.key({ key: 'down' })
  expect(await step()).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  await ui.key({ key: 'down' })
  expect((await step())?.model).toBe('claude-haiku-5-5')
  await ui.key({ key: 'up' })
  await ui.key({ key: 'up' })

  expect(await step()).toEqual({ model: 'claude-fable-5-2', effort: 'max' })
  await ui.unmount()
})

test('an arrow key with nowhere to go does not switch the mod on', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The dot mirrors the session on Sonnet 5.5 at Default: left is the edge.
  await ui.key({ key: 'left' })

  expect(await step()).toEqual(SESSION)
  await ui.unmount()
})

test('the keyboard reaches More models and Use session model', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Down from Sonnet 5.5 is Haiku 5.5, the last row; down again is the footer.
  await ui.key({ key: 'down' })
  expect((await step())?.model).toBe('claude-haiku-5-5')
  await ui.key({ key: 'down' })
  await ui.key({ key: 'right' })
  await ui.key({ key: 'return' })
  expect(await step()).toEqual(SESSION)

  await ui.key({ key: 'down' })
  await ui.key({ key: 'down' })
  await ui.key({ key: 'return' })
  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeDefined()
  await ui.unmount()
})

test('an older model that was picked stays in sight when the rest fold away', async ($, on) => {
  const { step } = await start($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.pointer({ type: 'down', ...MORE, button: 'left' })
  await ui.pointer({ type: 'up', ...MORE, button: 'left' })
  // Unfolded, the older rows take one line each from screen row 11: Opus 5 is the second.
  await ui.pointer({ type: 'down', x: 12 + 6 * 4 + 3, y: 12, button: 'left' })
  await ui.pointer({ type: 'up', x: 12 + 6 * 4 + 3, y: 12, button: 'left' })
  expect(await step()).toEqual({ model: 'claude-opus-5', effort: 'xhigh' })

  // Seven older rows, the hint line and a blank one put the footer on screen row 20.
  await ui.pointer({ type: 'down', x: 3, y: 20, button: 'left' })
  await ui.pointer({ type: 'up', x: 3, y: 20, button: 'left' })
  await ui.key({ key: 'up' })
  expect((await step())?.model).toBe('claude-haiku-5-5')

  expect(await ui.find({ type: 'Text', text: 'Opus 5', in: 'grid' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Opus 4.8', in: 'grid' })).toBeUndefined()
  await ui.unmount()
})

const COLS = ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultracode']
const SHORT = ['Def', 'Low', 'Med', 'High', 'Extra', 'Max', 'Ultra']

test('every column name is centred on its dots, at every cell width', () => {
  for (const isMono of [false, true]) {
    for (let cell = 3; cell <= 11; cell += 1) {
      const header = headerFor({ cols: COLS, shortCols: SHORT, labelWidth: 12, cell, gutter: 3, isMono })
      const seen: number[] = []
      for (const slots of header.lines) {
        let x = 0
        for (const slot of slots) {
          x += slot.lead
          // The dot's box starts at 12 + cell * col and is one cell wide.
          expect(x + slot.width / 2).toBe(12 + cell * slot.col + cell / 2)
          // A cell for every character on both surfaces, so no name can wrap.
          expect(slot.width).toBeGreaterThanOrEqual((header.names[slot.col] ?? '').length)
          x += slot.width
          seen.push(slot.col)
        }
        expect(x).toBeLessThanOrEqual(12 + cell * 7 + 3)
      }
      expect(seen.sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
      // One spelling for the whole header, never a mix.
      expect(header.names === COLS || header.names === SHORT).toBe(true)
    }
  }
})

test('names are written out wherever they fit, and on one line from 8 cells', () => {
  const at = (cell: number, isMono: boolean) =>
    headerFor({ cols: COLS, shortCols: SHORT, labelWidth: 12, cell, gutter: 3, isMono })

  expect(at(3, false).names).toBe(SHORT)
  expect(at(5, false).names).toBe(COLS)
  expect(at(5, false).lines).toHaveLength(2)
  expect(at(5, true).names).toBe(SHORT)
  expect(at(6, true).names).toBe(COLS)
  expect(at(8, true).lines).toHaveLength(1)
  expect(at(8, false).lines).toHaveLength(1)
})

test('the line under the grid says what the column means and what answered', () => {
  expect(captionFor(off, null)).toContain('Following the session. Click')
  expect(captionFor(off, null, 'claude-opus-5-5')).toContain('Following the session. Click')
  expect(captionFor(off, null, 'claude-opus-6')).toContain('on claude-opus-6, which has no row here')
  expect(captionFor({ ...on_, effort: 'high' }, null)).toBe('Set. Your next prompt uses it.')
  expect(captionFor({ ...on_, effort: 'default' }, null)).toContain("keeps the session's effort level")
  expect(captionFor({ ...on_, effort: 'ultracode' }, null)).toContain('adds the word ultracode')
  // Haiku 5.5 has no Ultracode, so the line does not claim it.
  expect(captionFor({ ...on_, model: 'haiku-5-5', effort: 'ultracode' }, null)).not.toContain('ultracode')
  expect(captionFor({ ...on_, effort: 'high' }, 'claude-fable-5-2')).toBe('Last answer came from Fable 5.2.')
  // A model with no row is named as it came, not as the first row.
  expect(captionFor({ ...on_, effort: 'high' }, 'some-other-model')).toBe('Last answer came from some-other-model.')
})
