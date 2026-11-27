import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, PromptSubmitInput, Register } from 'claude-code'

import type { Choice, Seen, View } from '../types'

const PANE = 'model-picker'
const STORE_KEY = 'choice-4'
const KEYWORD = 'ultracode'
// Opened by the button, so it asks for the seat above the prompt. The columns
// are what a dock needs for the effort names to sit on one line.
const OPEN = { id: PANE, title: 'Model picker', focus: true, closeOnEscape: true, columns: 60, rows: 13 } as const

// The model rows, in the order of the app's own menu. `max` is the last effort
// column the model may use; `isOlder` rows stay folded behind "More models".
// The mod API lists neither models nor their levels, so both are kept here by
// hand. Every id is one the Claude API's published model list carries.
const MODELS = [
  { key: 'fable-5-2', label: 'Fable 5.2', id: 'claude-fable-5-2', family: 'fable', max: 6, isOlder: false },
  { key: 'opus-5-5', label: 'Opus 5.5', id: 'claude-opus-5-5', family: 'opus', max: 6, isOlder: false },
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
  { page: 0, ran: null } as View,
  { shape: 'view-3' },
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

// Model columns per page: the current models first, older ones on the pages after.
const PER_PAGE = 4
const PAGES = [
  MODELS.filter(one => !one.isOlder),
  ...Array.from({ length: Math.ceil(MODELS.filter(one => one.isOlder).length / PER_PAGE) }, (_, i) =>
    MODELS.filter(one => one.isOlder).slice(i * PER_PAGE, (i + 1) * PER_PAGE),
  ),
]
const pageOf = (key: string | null) => Math.max(0, PAGES.findIndex(page => page.some(one => one.key === key)))
// Effort rows, top to bottom: the most effort on top, so up means more.
const ROWS = EFFORTS.map((one, index) => ({ key: one.key, label: one.label, index })).reverse()

const open = async ($: EngineInterface) => $.ui.open(OPEN)

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
    // Open on the page that holds the dot.
    const now = await read($, choice)
    const page = pageOf(now.isOn ? now.model : modelRowFor(model))
    await update($, view, was => ({ ...was, page }))

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
    const now = await read($, choice)
    const session = await read($, seen)
    const showing = await read($, view)
    // Until a cell is picked, the dot sits where the session already is.
    const modelKey = now.isOn ? now.model : modelRowFor(session.model)
    const effortKey =
      modelKey === null ? null : clampEffort(modelKey, now.isOn ? now.effort : (session.effort ?? 'default'))
    const page = Math.max(0, Math.min(PAGES.length - 1, showing.page))
    const models = PAGES[page] ?? PAGES[0] ?? []
    // A model on another page, or one the grid has no column for, gets no dot here.
    const col = models.findIndex(one => one.key === modelKey)
    const at = col < 0 ? { row: -1, col: -1 } : { row: ROWS.findIndex(one => one.key === effortKey), col }
    const summary = now.isOn ? describe(now) : 'Using the session model'

    // Minimised into the side column, clicks may not arrive: show the choice at a glance.
    if (e.props.placement === 'widget' || (e.surface !== 'desktop' && e.surface !== 'terminal')) {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Text bold>{summary}</Text>
          <Text dimColor>
            {e.props.placement === 'widget' ? 'Open the pane to change it.' : 'The grid needs the desktop app or a terminal.'}
          </Text>
        </Box>
      )
    }

    const { Box, Text, Client } = $.ui.resolve(e)
    const labelWidth = 11
    const inner = Math.max(0, e.props.bodyColumns - 2)
    const cell = Math.max(6, Math.min(13, Math.floor((inner - labelWidth) / PER_PAGE)))

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client
          key="grid"
          module="./grid.tsx"
          props={{
            efforts: ROWS,
            models: models.map(one => ({ key: one.key, label: one.label, max: one.max })),
            at,
            isOn: now.isOn,
            page,
            pages: PAGES.length,
            labelWidth,
            cell,
            isMono: e.surface === 'terminal',
          }}
          width={labelWidth + cell * models.length}
          height={ROWS.length + 3}
        />
        <Text dimColor>{captionFor(now, showing.ran, session.model)}</Text>
      </Box>
    )
  })

  // A pick from the grid. The data comes from the drawing surface: check it.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'grid') return next(e)
    const data = e.data as { model?: unknown; col?: unknown; page?: unknown; reset?: unknown } | null
    if (typeof data?.page === 'number' && Number.isFinite(data.page)) {
      const page = Math.max(0, Math.min(PAGES.length - 1, Math.trunc(data.page)))
      await update($, view, was => ({ ...was, page }))

      return {}
    }
    // Back to the session's own model and effort: the mod changes nothing again.
    if (data?.reset === true) {
      await update($, choice, () => INITIAL)
      await update($, view, was => ({ ...was, ran: null }))
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
    await update($, view, one => ({ ...one, ran: null }))
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
