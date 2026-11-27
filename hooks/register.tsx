import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, PromptSubmitInput, Register } from 'claude-code'

import type { Choice, Seen, View } from '../types'

const PANE = 'model-picker'
const STORE_KEY = 'choice-3'
const KEYWORD = 'ultracode'
// Opened by the button, so it asks for the seat above the prompt.
const OPEN = { id: PANE, title: 'Model picker', focus: true, closeOnEscape: true, rows: 22 } as const

// The model rows, in the order of the app's own menu. `max` is the last effort
// column the model may use; `isOlder` rows stay folded behind "More models".
// The mod API lists neither models nor their levels, so both are kept here by
// hand, and the ids of the older models are the naming pattern's best guess.
const MODELS = [
  { key: 'opus-5-5', label: 'Opus 5.5', id: 'claude-opus-5-5', family: 'opus', max: 5, isOlder: false },
  { key: 'fable-5-2', label: 'Fable 5.2', id: 'claude-fable-5-2', family: 'fable', max: 5, isOlder: false },
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

// The effort levels, named as the app's own effort menu names them. Default
// sends no level of the mod's own, so the session's setting stands.
const EFFORTS = [
  { key: 'default', label: 'Default', short: 'Def', tiny: 'D', level: undefined },
  { key: 'low', label: 'Low', short: 'Low', tiny: 'L', level: 'low' },
  { key: 'medium', label: 'Medium', short: 'Med', tiny: 'M', level: 'medium' },
  { key: 'high', label: 'High', short: 'High', tiny: 'H', level: 'high' },
  { key: 'xhigh', label: 'Extra', short: 'Xtra', tiny: 'X', level: 'xhigh' },
  { key: 'max', label: 'Max', short: 'Max', tiny: 'Mx', level: 'max' },
] as const satisfies readonly {
  key: string
  label: string
  short: string
  tiny: string
  level?: ModelEffort
}[]

const INITIAL: Choice = { model: MODELS[0].key, effort: 'default', isUltra: false, isOn: false }
// Bump both tags when Choice's fields change.
const choice = atom({ plugin: 'model-picker', key: 'choice' } as const, INITIAL, {
  shape: 'choice-3',
})
const seen = atom(
  { plugin: 'model-picker', key: 'seen' } as const,
  { model: null, effort: null } as Seen,
  { shape: 'seen-1' },
)

const view = atom(
  { plugin: 'model-picker', key: 'view' } as const,
  { isExpanded: false, ran: null } as View,
  { shape: 'view-1' },
)

const modelOf = (key: string) => MODELS.find(model => model.key === key) ?? MODELS[0]
const effortOf = (key: string) => EFFORTS.find(effort => effort.key === key) ?? EFFORTS[0]

/** The row of a model as the session names it: a full id or an alias such as `opus`. */
export const modelKeyFor = (name: string | null) => {
  if (name === null) return MODELS[0].key
  const lower = name.toLowerCase()
  const exact = [...MODELS]
    .sort((a, b) => b.id.length - a.id.length)
    .find(model => lower.startsWith(model.id))
  if (exact !== undefined) return exact.key

  return MODELS.find(model => model.family !== null && lower.includes(model.family))?.key ?? MODELS[0].key
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
    typeof one.isUltra === 'boolean' &&
    typeof one.isOn === 'boolean'
  )
}

const describe = (now: Choice) => {
  const base = `${modelOf(now.model).label} · ${effortOf(now.effort).label}`

  return now.isUltra ? `${base} · Ultracode` : base
}

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
  if (!now.isOn || !now.isUltra || e.command !== undefined || e.isMeta === true) return e.text
  if (e.text.toLowerCase().includes(KEYWORD)) return e.text

  return `${e.text}\n\n${KEYWORD}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'model-picker',
      description: 'Pick the model and effort level',
    })
    const kept = await $.store.get(STORE_KEY)
    if (isChoice(kept)) await update($, choice, () => kept)
    const model = await $.session.model().catch(() => null)
    if (model !== null) await update($, seen, was => ({ ...was, model }))

    return next(e)
  })

  on('command.run', { command: 'model-picker' }, async $ => {
    const opened = await $.ui.open(OPEN)

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
      else await $.ui.open(OPEN)
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
    const modelKey = now.isOn ? now.model : modelKeyFor(session.model)
    const effortKey = clampEffort(modelKey, now.isOn ? now.effort : (session.effort ?? 'default'))
    // An older model that is the pick is shown whether or not the rest are.
    const rows = MODELS.filter(one => !one.isOlder || showing.isExpanded || one.key === modelKey)
    const at = {
      row: Math.max(0, rows.findIndex(one => one.key === modelKey)),
      col: Math.max(0, EFFORTS.findIndex(one => one.key === effortKey)),
    }
    const ran = showing.ran === null ? null : modelOf(modelKeyFor(showing.ran))

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
    const labelWidth = 13
    const room = Math.max(0, e.props.bodyColumns - 6 - labelWidth)
    const cell = Math.max(3, Math.min(9, Math.floor(room / EFFORTS.length)))
    const cols = EFFORTS.map(one => (cell >= 8 ? one.label : cell >= 5 ? one.short : one.tiny))

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client
          key="grid"
          module="./grid.tsx"
          props={{
            rows: rows.map(one => ({ key: one.key, label: one.label, max: one.max })),
            cols,
            levels: EFFORTS.map(one => one.label),
            at,
            isUltra: now.isUltra,
            isOn: now.isOn,
            hasMore: true,
            isExpanded: showing.isExpanded,
            labelWidth,
            cell,
          }}
          width={labelWidth + cell * EFFORTS.length + 4}
          height={5 + rows.length * 2 + 2 + 2}
        />
        <Text dimColor>
          {!now.isOn
            ? 'Drag the dot, or click a cell. Nothing changes until you do.'
            : ran === null
              ? 'Set. Your next prompt uses it.'
              : `Last answer came from ${ran.label}.`}
        </Text>
      </Box>
    )
  })

  // A pick from the grid. The data comes from the drawing surface: check it.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'grid') return next(e)
    const data = e.data as { model?: unknown; col?: unknown; isUltra?: unknown; expand?: unknown } | null
    if (typeof data?.expand === 'boolean') {
      const isExpanded = data.expand
      await update($, view, was => ({ ...was, isExpanded }))

      return {}
    }
    const model = MODELS.find(one => one.key === data?.model)
    if (model === undefined || typeof data?.col !== 'number' || !Number.isFinite(data.col)) return {}
    const effort = EFFORTS[Math.max(0, Math.min(model.max, Math.trunc(data.col)))] ?? EFFORTS[0]
    const to: Choice = {
      model: model.key,
      effort: effort.key,
      isUltra: data.isUltra === true,
      isOn: true,
    }
    await update($, choice, () => to)
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
    if (!now.isOn) {
      // Remember what the session sends, so the menu can default to it.
      const effort = EFFORTS.find(one => one.level !== undefined && one.level === e.effort)?.key ?? null
      const was = await read($, seen)
      if (was.model !== e.model || was.effort !== effort) {
        await update($, seen, () => ({ model: e.model, effort }))
      }

      return yield* next(e)
    }
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
