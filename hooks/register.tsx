import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, PromptSubmitInput, Register } from 'claude-code'

import type { Choice, Seen, View } from '../types'

const PANE = 'model-picker'
const STORE_KEY = 'choice-4'
const KEYWORD = 'ultracode'
// Opened by the button, so it asks for the seat above the prompt. The columns
// are what a dock needs for the effort names to sit on one line.
const OPEN = { id: PANE, title: 'Model picker', focus: true, closeOnEscape: true, columns: 80 } as const

// The model rows, in the order of the app's own menu. `max` is the last effort
// column the model may use; `isOlder` rows stay folded behind "More models".
// The mod API lists neither models nor their levels, so both are kept here by
// hand. Every id is one the Claude API's published model list carries.
const MODELS = [
  { key: 'opus-5-5', label: 'Opus 5.5', id: 'claude-opus-5-5', family: 'opus', max: 6, isOlder: false },
  { key: 'fable-5-2', label: 'Fable 5.2', id: 'claude-fable-5-2', family: 'fable', max: 6, isOlder: false },
  { key: 'sonnet-5-5', label: 'Sonnet 5.5', id: 'claude-sonnet-5-5', family: 'sonnet', max: 3, isOlder: false },
  { key: 'haiku-5-5', label: 'Haiku 5.5', id: 'claude-haiku-5-5', family: 'haiku', max: 0, isOlder: false },
  { key: 'sonnet-5', label: 'Sonnet 5', id: 'claude-sonnet-5', family: null, max: 3, isOlder: true },
  { key: 'opus-5', label: 'Opus 5', id: 'claude-opus-5', family: null, max: 4, isOlder: true },
  { key: 'fable-5', label: 'Fable 5', id: 'claude-fable-5', family: null, max: 4, isOlder: true },
  { key: 'opus-4-8', label: 'Opus 4.8', id: 'claude-opus-4-8', family: null, max: 4, isOlder: true },
  { key: 'opus-4-7', label: 'Opus 4.7', id: 'claude-opus-4-7', family: null, max: 4, isOlder: true },
  { key: 'opus-4-6', label: 'Opus 4.6', id: 'claude-opus-4-6', family: null, max: 3, isOlder: true },
  { key: 'sonnet-4-6', label: 'Sonnet 4.6', id: 'claude-sonnet-4-6', family: null, max: 3, isOlder: true },
] as const

// The effort columns, named as the app's own effort menu names them. Default
// sends no level of the mod's own, so the session's setting stands. Ultracode
// is Max with the keyword added to the prompt: effort itself has five levels.
const EFFORTS = [
  { key: 'default', label: 'Default', short: 'Def', level: undefined, hint: "Keeps the session's effort level." },
  { key: 'low', label: 'Low', short: 'Low', level: 'low', hint: '' },
  { key: 'medium', label: 'Medium', short: 'Med', level: 'medium', hint: '' },
  { key: 'high', label: 'High', short: 'High', level: 'high', hint: '' },
  { key: 'xhigh', label: 'Extra high', short: 'Extra', level: 'xhigh', hint: '' },
  { key: 'max', label: 'Max', short: 'Max', level: 'max', hint: '' },
  {
    key: 'ultracode',
    label: 'Ultracode',
    short: 'Ultra',
    level: 'max',
    hint: 'Max effort plus the ultracode keyword.',
  },
] as const satisfies readonly { key: string; label: string; short: string; level?: ModelEffort; hint: string }[]

const INITIAL: Choice = { model: MODELS[0].key, effort: 'default', isOn: false }
// Bump both tags when Choice's fields change.
const choice = atom({ plugin: 'model-picker', key: 'choice' } as const, INITIAL, {
  shape: 'choice-4',
})
const seen = atom(
  { plugin: 'model-picker', key: 'seen' } as const,
  { model: null, effort: null } as Seen,
  { shape: 'seen-1' },
)

const view = atom(
  { plugin: 'model-picker', key: 'view' } as const,
  { isExpanded: false, ran: null, kept: null } as View,
  { shape: 'view-2' },
)

const modelOf = (key: string) => MODELS.find(model => model.key === key) ?? MODELS[0]
const effortOf = (key: string) => EFFORTS.find(effort => effort.key === key) ?? EFFORTS[0]

/**
 * The row a model name belongs to; null when none does. A full id finds its
 * row, dated or tagged (`-20260101`, `[1m]`) or not; a bare alias such as
 * `opus` finds its family's newest. A version with no row finds none: it is
 * never drawn as a neighbour.
 */
export const modelRowFor = (name: string | null) => {
  if (name === null) return null
  const lower = name.toLowerCase()
  const exact = MODELS.find(
    model => lower.startsWith(model.id) && /^(-\d{6,})?([^-\d].*)?$/.test(lower.slice(model.id.length)),
  )
  if (exact !== undefined) return exact.key
  const alias = lower.replace(/\[.*$/, '')
  if (/\d/.test(alias)) return null

  return MODELS.find(model => model.family !== null && alias.includes(model.family))?.key ?? null
}

/**
 * The line under the grid: what the picked column means, and the proof of the
 * pick. Untouched, it names a session model the grid has no row (and no dot) for.
 */
export const captionFor = (now: Choice, ran: string | null, session: string | null = null) => {
  if (!now.isOn) {
    const where = session !== null && modelRowFor(session) === null ? ` on ${session}, which has no row here` : ''

    return `Following the session${where}. Click a cell or drag the dot to choose a model and effort.`
  }
  const effort = clampEffort(now.model, now.effort)
  const meaning =
    effort === 'ultracode'
      ? 'Ultracode sends Max effort and adds the word ultracode to each prompt. '
      : effort === 'default'
        ? "Default keeps the session's effort level. "
        : ''
  if (ran === null) return `${meaning}Set. Your next prompt uses it.`
  const row = modelRowFor(ran)

  // An id with no row is shown as it came: never under another model's name.
  return `${meaning}Last answer came from ${row === null ? ran : modelOf(row).label}.`
}

/** The last effort column a model allows, pulling the current one back if needed. */
const clampEffort = (modelKey: string, effortKey: string) => {
  const max = modelOf(modelKey).max
  const col = Math.min(EFFORTS.findIndex(effort => effort.key === effortKey), max)

  return (EFFORTS[Math.max(0, col)] ?? EFFORTS[0]).key
}

const isChoice = (value: unknown): value is Choice => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>

  return (
    typeof one.model === 'string' &&
    typeof one.effort === 'string' &&
    typeof one.isOn === 'boolean'
  )
}

/** What the pane shows: the model the dot is on (null when the session's has no row) and the rows drawn. */
const drawn = async ($: EngineInterface) => {
  const now = await read($, choice)
  const session = await read($, seen)
  const showing = await read($, view)
  // Until a cell is picked, the dot sits where the session already is.
  const modelKey = now.isOn ? now.model : modelRowFor(session.model)
  // An older model that is the pick is shown whether or not the rest are, and
  // stays in sight after the dot moves off it.
  const rows = MODELS.filter(
    one => !one.isOlder || showing.isExpanded || one.key === modelKey || one.key === showing.kept,
  )

  return { now, session, showing, modelKey, rows }
}

/**
 * The rows the pane needs for what is drawn: two lines of names and a blank
 * one, the models (a current one takes two rows), the hint and footer lines,
 * then a gap and two lines of caption.
 */
const rowsFor = (rows: readonly { isOlder: boolean }[]) =>
  3 + rows.reduce((sum, one) => sum + (one.isOlder ? 1 : 2), 0) + (rows.at(-1)?.isOlder === true ? 1 : 0) + 2 + 3

const open = async ($: EngineInterface) => $.ui.open({ ...OPEN, rows: rowsFor((await drawn($)).rows) })

const describe = (now: Choice) => `${modelOf(now.model).label} · ${effortOf(now.effort).label}`

/** What a main-loop request is sent with under this choice. */
export const requestFor = (now: Choice, sent: { model: string; effort?: ModelEffort | number }) => {
  if (!now.isOn) return sent
  const model = modelOf(now.model)
  const level = effortOf(clampEffort(now.model, now.effort)).level

  return { model: model.id, effort: level ?? sent.effort }
}

/**
 * Everything a prompt needs before it goes out: the Ultracode keyword, when
 * it's on. Answers the text to send; never throws.
 */
const prepare = async ($: EngineInterface, e: PromptSubmitInput) => {
  const now = await read($, choice)
  if (!now.isOn || now.effort !== 'ultracode' || e.command !== undefined || e.isMeta === true) return e.text
  if (e.text.toLowerCase().includes(KEYWORD)) return e.text

  return `${e.text}\n\n${KEYWORD}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'model-picker',
      description: 'Pick the model and effort level',
    })
    $.ui.status(undefined)
    const kept = await $.store.get(STORE_KEY)
    // A kept choice naming a model the table no longer has is no choice.
    if (isChoice(kept) && MODELS.some(one => one.key === kept.model)) await update($, choice, () => kept)
    const model = await $.session.model().catch(() => null)
    if (model !== null) await update($, seen, was => ({ ...was, model }))

    return next(e)
  })

  on('command.run', { command: 'model-picker' }, async $ => {
    const opened = await open($)

    return { text: opened.isPlaced ? 'Model picker opened.' : `Model picker: ${opened.reason}` }
  })

  // The way in: one button above the prompt that names the choice and opens
  // the picker, or closes it when it is already showing.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await read($, choice)
    const { Box, Button } = $.ui.resolve(e)
    const toggle = async () => {
      const shown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
      if (shown) await $.ui.close({ id: PANE })
      else await open($)
    }

    return (
      <Box>
        <Button key="open" label={now.isOn ? describe(now) : 'Pick model'} onPress={toggle} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { now, session, showing, modelKey, rows } = await drawn($)
    const effortKey =
      modelKey === null ? null : clampEffort(modelKey, now.isOn ? now.effort : (session.effort ?? 'default'))
    // A session model with no row gets no dot: the caption names it instead.
    const at =
      modelKey === null
        ? { row: -1, col: -1 }
        : {
            row: rows.findIndex(one => one.key === modelKey),
            col: Math.max(0, EFFORTS.findIndex(one => one.key === effortKey)),
          }

    if (e.surface !== 'desktop' && e.surface !== 'terminal') {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Text bold>{now.isOn ? describe(now) : 'Using the session model'}</Text>
          <Text dimColor>The grid needs the desktop app or a terminal.</Text>
        </Box>
      )
    }

    const { Box, Text, Client } = $.ui.resolve(e)
    // What is left for the grid inside the pane's own padding.
    const inner = Math.max(0, e.props.bodyColumns - 2)
    const cell = Math.max(3, Math.min(11, Math.floor((inner - 12 - 3) / EFFORTS.length)))
    // A pane too narrow for the smallest grid gives up the gutter, then a label cell.
    const spare = inner - cell * EFFORTS.length
    const labelWidth = Math.max(11, Math.min(12, spare))
    const gutter = Math.max(0, Math.min(3, spare - labelWidth))

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client
          key="grid"
          module="./grid.tsx"
          props={{
            rows: rows.map(one => ({ key: one.key, label: one.label, max: one.max, isOlder: one.isOlder })),
            cols: EFFORTS.map(one => one.label),
            shortCols: EFFORTS.map(one => one.short),
            hints: EFFORTS.map(one => one.hint),
            at,
            isOn: now.isOn,
            isExpanded: showing.isExpanded,
            moreCount: MODELS.length - rows.length,
            labelWidth,
            cell,
            gutter,
            isMono: e.surface === 'terminal',
          }}
          width={labelWidth + cell * EFFORTS.length + gutter}
        />
        <Text dimColor>{captionFor(now, showing.ran, session.model)}</Text>
      </Box>
    )
  })

  // A pick from the grid. The data comes from the drawing surface: check it.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'grid') return next(e)
    const data = e.data as { model?: unknown; col?: unknown; expand?: unknown; reset?: unknown } | null
    if (typeof data?.expand === 'boolean') {
      const isExpanded = data.expand
      await update($, view, was => ({ ...was, isExpanded }))
      // The unfolded grid is taller: ask for the room, so its last line stays in sight.
      await open($).catch(() => undefined)

      return {}
    }
    // Back to the session's own model and effort: the mod changes nothing again.
    if (data?.reset === true) {
      await update($, choice, () => INITIAL)
      await update($, view, was => ({ ...was, ran: null, kept: null }))
      await $.store.set(STORE_KEY, INITIAL)
      // The dot goes back to what the session is on now, not what it was on before the pick.
      const model = await $.session.model().catch(() => null)
      if (model !== null) await update($, seen, was => ({ ...was, model }))

      return {}
    }
    const model = MODELS.find(one => one.key === data?.model)
    if (model === undefined || typeof data?.col !== 'number' || !Number.isFinite(data.col)) return {}
    const effort = EFFORTS[Math.max(0, Math.min(model.max, Math.trunc(data.col)))] ?? EFFORTS[0]
    const to: Choice = { model: model.key, effort: effort.key, isOn: true }
    const was = await read($, choice)
    if (was.isOn && was.model === to.model && was.effort === to.effort) return {}
    await update($, choice, () => to)
    // The proof under the grid belongs to the pick before this one.
    await update($, view, one => ({ ...one, ran: null, kept: model.isOlder ? model.key : one.kept }))
    await $.store.set(STORE_KEY, to)

    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    // Nothing here may stop a prompt: `next` runs once, whatever this works out.
    const text = await prepare($, e).catch(() => e.text)

    return next(text === e.text ? e : { ...e, text })
  })

  // A rewrite lasts one request, so every main-loop request is rewritten.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const now = await read($, choice)
    // Remember what the session itself sends, picked or not: the dot goes back there.
    const sessionEffort = EFFORTS.find(one => one.level !== undefined && one.level === e.effort)?.key ?? null
    const was = await read($, seen)
    if (was.model !== e.model || was.effort !== sessionEffort) {
      await update($, seen, () => ({ model: e.model, effort: sessionEffort }))
    }
    if (!now.isOn) return yield* next(e)
    const { model, effort } = requestFor(now, { model: e.model, effort: e.effort })
    const response = yield* next({ ...e, model, effort })
    // The proof: the model the API says answered, shown under the grid.
    const ran = response.usage?.model ?? null
    if (ran !== null && (await read($, view)).ran !== ran) {
      await update($, view, was => ({ ...was, ran }))
    }

    return response
  })
}
