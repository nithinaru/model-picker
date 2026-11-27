import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, PromptSubmitInput, Register } from 'claude-code'

import type { Choice, Seen } from '../types'

const PANE = 'model-picker'
const STORE_KEY = 'choice-3'
const KEYWORD = 'ultracode'
// Opened by the button, so it asks for the seat above the prompt.
const OPEN = { id: PANE, title: 'Model picker', focus: true, closeOnEscape: true, rows: 8 } as const

// The model list, in the order of the app's own menu, older models last.
// `max` is the last effort column the model may use; the mod API lists
// neither models nor their levels, so both are kept here by hand.
const MODELS = [
  { key: 'opus-5-5', label: 'Opus 5.5', id: 'claude-opus-5-5', family: 'opus', max: 5 },
  { key: 'fable-5-2', label: 'Fable 5.2', id: 'claude-fable-5-2', family: 'fable', max: 5 },
  { key: 'sonnet-5-5', label: 'Sonnet 5.5', id: 'claude-sonnet-5-5', family: 'sonnet', max: 3 },
  { key: 'haiku-5-5', label: 'Haiku 5.5', id: 'claude-haiku-5-5', family: 'haiku', max: 0 },
  { key: 'opus-5', label: 'Opus 5', id: 'claude-opus-5', family: null, max: 4 },
  { key: 'sonnet-5', label: 'Sonnet 5', id: 'claude-sonnet-5', family: null, max: 3 },
] as const

// The effort levels, named as the app's own effort menu names them. Default
// sends no level of the mod's own, so the session's setting stands.
const EFFORTS = [
  { key: 'default', label: 'Default', level: undefined },
  { key: 'low', label: 'Low', level: 'low' },
  { key: 'medium', label: 'Medium', level: 'medium' },
  { key: 'high', label: 'High', level: 'high' },
  { key: 'xhigh', label: 'Extra high', level: 'xhigh' },
  { key: 'max', label: 'Max', level: 'max' },
] as const satisfies readonly { key: string; label: string; level?: ModelEffort }[]

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

const modelOf = (key: string) => MODELS.find(model => model.key === key) ?? MODELS[0]
const effortOf = (key: string) => EFFORTS.find(effort => effort.key === key) ?? EFFORTS[0]

/** The row of a model as the session names it: a full id or an alias such as `opus`. */
export const modelKeyFor = (name: string | null) => {
  if (name === null) return MODELS[0].key
  const lower = name.toLowerCase()
  const exact = MODELS.find(model => lower.startsWith(model.id))
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
    // Until a model is picked, the menu defaults to the session's own model.
    const modelKey = now.isOn ? now.model : modelKeyFor(session.model)
    const effortKey = now.isOn ? now.effort : clampEffort(modelKey, session.effort ?? 'default')
    const model = modelOf(modelKey)

    const set = async (next: Partial<Choice>) => {
      const to = await update($, choice, was => ({
        model: was.isOn ? was.model : modelKey,
        effort: was.isOn ? was.effort : effortKey,
        isUltra: was.isUltra,
        isOn: true,
        ...next,
      }))
      await $.store.set(STORE_KEY, to)
    }

    const { Box, Text, Button, Select } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text size="heading" bold>
            {model.label}
          </Text>
          <Box flexDirection="row" gap={1}>
            {now.isUltra && <Text color="claude">Ultracode</Text>}
            <Text color={now.isOn ? 'claude' : 'inactive'}>{effortOf(effortKey).label}</Text>
          </Box>
        </Box>
        <Select
          key="model"
          label="Model"
          value={modelKey}
          options={MODELS.map(one => ({ value: one.key, label: one.label }))}
          onSelect={value => {
            const to = modelOf(value)

            void set({ model: to.key, effort: clampEffort(to.key, effortKey) })
          }}
        />
        <Box flexDirection="row" gap={1}>
          {EFFORTS.filter(effort => EFFORTS.findIndex(one => one.key === effort.key) <= model.max).map(
            effort => (
              <Button
                key={`effort-${effort.key}`}
                label={effort.label}
                variant={effortKey === effort.key ? 'primary' : 'secondary'}
                onPress={() => void set({ effort: effort.key })}
              />
            ),
          )}
        </Box>
        <Button
          key="ultra"
          label={now.isUltra ? 'Ultracode on' : 'Ultracode off'}
          variant={now.isUltra ? 'primary' : 'secondary'}
          onPress={() => void set({ isUltra: !now.isUltra })}
        />
        <Text dimColor>
          {now.isOn ? 'Applies to every prompt in this session.' : 'Pick a model to turn this on.'}
        </Text>
      </Box>
    )
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

    return yield* next({ ...e, model, effort })
  })
}
