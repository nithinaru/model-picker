import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, PromptSubmitInput, Register } from 'claude-code'

import type { Choice, Seen } from '../types'

const PANE = 'model-picker'
const STORE_KEY = 'choice-2'
const KEYWORD = 'ultracode'
const OPEN = { id: PANE, title: 'Model picker', focus: true, closeOnEscape: true } as const

// The grid's rows, in the order of the app's own model menu, older models last.
// `max` is the last effort column the model may use; the mod API lists neither
// models nor their levels, so both are kept here by hand.
const MODELS = [
  { key: 'auto', label: 'Auto', id: null, family: null, max: 5 },
  { key: 'opus-5-5', label: 'Opus 5.5', id: 'claude-opus-5-5', family: 'opus', max: 5 },
  { key: 'fable-5-2', label: 'Fable 5.2', id: 'claude-fable-5-2', family: 'fable', max: 5 },
  { key: 'sonnet-5-5', label: 'Sonnet 5.5', id: 'claude-sonnet-5-5', family: 'sonnet', max: 3 },
  { key: 'haiku-5-5', label: 'Haiku 5.5', id: 'claude-haiku-5-5', family: 'haiku', max: 0 },
  { key: 'opus-5', label: 'Opus 5', id: 'claude-opus-5', family: null, max: 4 },
  { key: 'sonnet-5', label: 'Sonnet 5', id: 'claude-sonnet-5', family: null, max: 3 },
] as const

// The grid's columns, named as the app's effort menu names them. Default sends
// no level of the mod's own, so the session's setting stands.
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

// What Auto chooses between, by how much the prompt asks for.
const TIERS = {
  quick: 'claude-haiku-5-5',
  everyday: 'claude-sonnet-5-5',
  demanding: 'claude-opus-5-5',
} as const
const TIER_LABELS = ['quick', 'everyday', 'demanding'] as const

const INITIAL: Choice = {
  model: 'auto',
  effort: 'default',
  isUltra: false,
  auto: null,
  isOn: false,
}
// Bump the tags when the fields change.
const choice = atom({ plugin: 'model-picker', key: 'choice' } as const, INITIAL, {
  shape: 'choice-2',
})
const seen = atom(
  { plugin: 'model-picker', key: 'seen' } as const,
  { model: null, effort: null } as Seen,
  { shape: 'seen-1' },
)

const rowOf = (key: string) => Math.max(0, MODELS.findIndex(model => model.key === key))
const colOf = (key: string) => Math.max(0, EFFORTS.findIndex(effort => effort.key === key))

/** The row of a model as the session names it: a full id or an alias such as `opus`. */
export const rowOfModel = (name: string | null) => {
  if (name === null) return 0
  const lower = name.toLowerCase()
  const exact = MODELS.findIndex(model => model.id !== null && lower.startsWith(model.id))
  if (exact >= 0) return exact

  return Math.max(0, MODELS.findIndex(model => model.family !== null && lower.includes(model.family)))
}

const isChoice = (value: unknown): value is Choice => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>

  return (
    typeof one.model === 'string' &&
    typeof one.effort === 'string' &&
    typeof one.isUltra === 'boolean' &&
    (one.auto === null || typeof one.auto === 'string') &&
    typeof one.isOn === 'boolean'
  )
}

/** The cell a request lands on: the row as asked, the column pulled back into it. */
export const snap = (row: number, col: number) => {
  const r = Math.max(0, Math.min(MODELS.length - 1, Math.trunc(row)))
  const c = Math.max(0, Math.min(MODELS[r]?.max ?? 0, Math.trunc(col)))

  return { row: r, col: c }
}

const describe = (now: Choice) => {
  const model = MODELS[rowOf(now.model)]
  const effort = EFFORTS[colOf(now.effort)]
  const base = `${model?.label ?? now.model} · ${effort?.label ?? now.effort}`

  return now.isUltra ? `${base} · Ultracode` : base
}

/** What a main-loop request is sent with under this choice. */
export const requestFor = (now: Choice, sent: { model: string; effort?: ModelEffort | number }) => {
  if (!now.isOn) return sent
  const row = MODELS[rowOf(now.model)]
  const model = row?.id ?? now.auto ?? sent.model
  // Auto may have picked a model below the chosen column: cap the level there.
  const picked = MODELS.find(one => one.id === model)
  const col = Math.min(colOf(now.effort), picked?.max ?? EFFORTS.length - 1)
  const level = EFFORTS[col]?.level

  return { model, effort: level ?? sent.effort }
}

/**
 * Everything a prompt needs before it goes out: Auto's pick for it, and the
 * keyword when Ultracode is on. It answers the text to send.
 */
const prepare = async ($: EngineInterface, e: PromptSubmitInput) => {
  const now = await read($, choice)
  if (!now.isOn || e.command !== undefined || e.isMeta === true) return e.text

  if (now.model === 'auto') {
    const tier = await $.model
      .classify(
        `How much does this request ask of a coding assistant?\n\n${e.text.slice(0, 4000)}`,
        TIER_LABELS,
      )
      .catch(() => undefined)
    const auto = TIERS[TIER_LABELS.find(label => label === tier) ?? 'everyday']
    await update($, choice, was => ({ ...was, auto }))
  }

  if (now.isUltra && !e.text.toLowerCase().includes(KEYWORD)) return `${e.text}\n\n${KEYWORD}`

  return e.text
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'model-picker',
      description: 'Pick the model and effort by dragging a dot across a grid',
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
  // the grid, or closes it when it is already showing.
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
    // An untouched dot sits where the session already is.
    const at = now.isOn
      ? { row: rowOf(now.model), col: colOf(now.effort) }
      : snap(rowOfModel(session.model), colOf(session.effort ?? 'default'))

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
    const labelWidth = 12
    const room = Math.max(0, e.props.bodyColumns - 2 - labelWidth)
    const cell = Math.max(3, Math.min(9, Math.floor(room / EFFORTS.length)))
    const cols = EFFORTS.map(one => (cell >= 8 ? one.label : cell >= 5 ? one.short : one.tiny))

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client
          key="grid"
          module="./grid.tsx"
          props={{
            rows: MODELS.map(one => one.label),
            cols,
            levels: EFFORTS.map(one => one.label),
            max: MODELS.map(one => one.max),
            at,
            isUltra: now.isUltra,
            isOn: now.isOn,
            labelWidth,
            cell,
          }}
          width={labelWidth + cell * EFFORTS.length}
          height={3 + MODELS.length * 2 + 1}
        />
        {now.isOn && now.model === 'auto' && (
          <Text dimColor>
            {now.auto === null ? 'Auto picks a model for each prompt.' : `Auto last picked ${now.auto}.`}
          </Text>
        )}
        <Text dimColor>
          Drag the dot to a model and a level. Rings are Default: no level of your own. Click
          Ultracode to switch it.
        </Text>
      </Box>
    )
  })

  // A choice from the grid. The data comes from the drawing surface: check it.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'grid') return next(e)
    const data = e.data as { row?: unknown; col?: unknown; isUltra?: unknown } | null
    if (typeof data?.row !== 'number' || typeof data.col !== 'number') return {}
    if (!Number.isFinite(data.row) || !Number.isFinite(data.col)) return {}
    const at = snap(data.row, data.col)
    const model = MODELS[at.row]
    const effort = EFFORTS[at.col]
    if (model === undefined || effort === undefined) return {}
    const to = await update($, choice, was => ({
      model: model.key,
      effort: effort.key,
      isUltra: data.isUltra === true,
      auto: model.key === 'auto' ? was.auto : null,
      isOn: true,
    }))
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
      // Remember what the session sends, so the dot can start there.
      const effort = EFFORTS.find(one => one.level !== undefined && one.level === e.effort)?.key ?? null
      const was = await read($, seen)
      if (was.model !== e.model || was.effort !== effort) {
        await update($, seen, () => ({ model: e.model, effort }))
      }

      return yield* next(e)
    }
    const { model, effort } = requestFor(now, { model: e.model, effort: e.effort })

    return yield* next({ ...e, model, effort })
  })
}
