import type { ClientModule } from 'claude-code'

// The grid: effort levels down the side (Ultracode on top), models across the
// top, one dot. The dot's neighbourhood is an ASCII ember that flickers while
// nobody touches it. It runs on the drawing surface with no `$`: a pick is
// posted to the hooks module when the pointer lets go, on a click, or on a key.

export type Effort = { key: string; label: string; index: number }
export type Model = { key: string; label: string; max: number }
export type At = { row: number; col: number }
type Foot = 'page' | 'reset'

export type GridProps = {
  /** Effort rows, top to bottom; `index` is the level's place in the mod's list. */
  efforts: readonly Effort[]
  /** Model columns on this page, left to right. `max` is the highest effort index allowed. */
  models: readonly Model[]
  /** The dot's row and column; a row of -1 when the session's model has no column here. */
  at: At
  isOn: boolean
  page: number
  pages: number
  labelWidth: number
  cell: number
  /** True where every character is one cell wide (a terminal). */
  isMono: boolean
}

type GridState = { hover: At | null; foot: Foot | null; tick: number }

// Theme keys, so every ink follows the person's theme. No fill: the pane's own surface shows through.
const TEXT = 'text'
const QUIET = 'inactive'
const OFF = 'subtle'
const CLAY = 'claude'
// No theme key is violet. This one keeps 3:1 contrast on white and on the app's dark surface.
const VIOLET = '#9488E6'

// The ember: one character per cell, dimmest to brightest, in clay shades.
const RAMP = ['.', ':', '-', '=', '+', '*', '#', '%', '@']
const SHADE = [
  '#6B3F30',
  '#7E4331',
  '#8F4C38',
  '#A3553F',
  '#B25C44',
  '#C96A4D',
  '#D97757',
  '#E88C63',
  '#F2A56F',
  '#FBE0B8',
]
const RADIUS = 9 // how far the ember reaches, in character cells
const ROW_STEP = 2.2 // a row is about this many characters tall
const FLICKER = 0.16 // how far a resting ember may shift each step
const GLIMMER_MS = 900

const MARKS = { desktop: { rest: '•', picked: '⬤' }, mono: { rest: '•', picked: '●' } } as const
const SETTLE_MS = 2000

const IDLE: GridState = { hover: null, foot: null, tick: 0 }
// A press and the moves after it reach this module before it has redrawn.
let drag: At | null = null
let shown: GridState = IDLE
// The cell just posted, shown until the hooks module's props answer it.
let pending: At | null = null
let stopSettle: (() => void) | null = null
let stopGlimmer: (() => void) | null = null

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const Grid: ClientModule<GridProps, GridState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { efforts, models, labelWidth, cell, isMono } = props
  const span = labelWidth + cell * models.length
  const footRow = efforts.length + 2
  const marks = isMono ? MARKS.mono : MARKS.desktop
  const hasPages = props.pages > 1
  const pageLabel = hasPages ? (props.page + 1 < props.pages ? 'More models' : 'First models') : ''
  const pageWidth = pageLabel.length
  const resetFull = 'Use session model'
  const resetLabel = props.isOn ? (span - pageWidth >= resetFull.length + 2 ? resetFull : 'Use session') : ''
  const resetWidth = resetLabel.length

  const redraw = (next: Partial<GridState>) => {
    shown = { ...shown, ...next, tick: shown.tick + 1 }
    surface.setState(shown)
  }

  // A new instance starts clean, and the ember starts its idle glimmer once.
  if (surface.state === undefined) {
    drag = null
    pending = null
    stopSettle?.()
    stopSettle = null
    stopGlimmer?.()
    stopGlimmer = surface.every(GLIMMER_MS, () => {
      if (drag !== null || shown.hover !== null || shown.foot !== null) return
      redraw({})
    })
  }
  shown = surface.state ?? IDLE
  const { hover, foot } = shown

  if (pending !== null && props.at.row === pending.row && props.at.col === pending.col) pending = null
  const at: At = drag ?? pending ?? props.at
  const isMine = props.isOn || drag !== null || pending !== null

  // A cell a model does not offer is pulled back to the last level it allows.
  const snapTo = (row: number, col: number): At => {
    const c = clamp(col, 0, models.length - 1)
    const r = clamp(row, 0, efforts.length - 1)
    const max = models[c]?.max ?? 0
    if ((efforts[r]?.index ?? 0) <= max) return { row: r, col: c }
    const fit = efforts.findIndex(effort => effort.index === max)

    return { row: fit < 0 ? r : fit, col: c }
  }
  const under = (x: number, y: number): At | Foot | null => {
    const line = Math.floor(y)
    if (line === footRow) {
      if (hasPages && x >= 0 && x < pageWidth) return 'page'
      if (resetWidth > 0 && x >= span - resetWidth && x < span) return 'reset'

      return null
    }
    const row = line - 1
    if (row < 0 || row >= efforts.length || x < 0 || x >= span) return null
    // An effort name keeps the model column the dot is in.
    const col = x < labelWidth ? Math.max(0, at.col) : Math.floor((x - labelWidth) / cell)

    return snapTo(row, col)
  }
  const nearest = (x: number, y: number): At => snapTo(Math.floor(y) - 1, Math.floor((x - labelWidth) / cell))

  const pick = (to: At) => {
    const model = models[to.col]
    const effort = efforts[to.row]
    if (model === undefined || effort === undefined) return
    const isSame = props.isOn && to.row === props.at.row && to.col === props.at.col
    if (isSame && pending === null) return
    pending = to
    surface.post({ model: model.key, col: effort.index })
    stopSettle?.()
    stopSettle = surface.every(SETTLE_MS, () => {
      stopSettle?.()
      stopSettle = null
      if (pending === null) return
      pending = null
      redraw({})
    })
  }
  const press = (which: Foot) => {
    if (which === 'page') {
      surface.post({ page: (props.page + 1) % props.pages })

      return
    }
    pending = null
    surface.post({ reset: true })
  }

  surface.onPointer(e => {
    if (e.type === 'enter') return
    if (e.type === 'leave') {
      if (drag === null && (shown.hover !== null || shown.foot !== null)) redraw({ hover: null, foot: null })

      return
    }
    if (e.type === 'up') {
      if (drag === null) return
      const to = drag
      drag = null
      pick(to)
      redraw({ hover: null, foot: null })

      return
    }
    const x = e.fine?.x ?? e.x
    const y = e.fine?.y ?? e.y
    // A move with no button held means the release was missed: the press is over.
    if (drag !== null && e.type === 'move' && e.button === undefined) drag = null
    if (drag !== null && e.type === 'move') {
      const to = nearest(x, y)
      if (drag.row !== to.row || drag.col !== to.col) {
        drag = to
        redraw({ hover: null, foot: null })
      }

      return
    }
    if (e.type === 'move' && e.button !== undefined) return
    const target = under(x, y)
    if (e.type === 'down') {
      if (e.button !== undefined && e.button !== 'left') return
      if (typeof target === 'string') {
        press(target)
        redraw({ hover: null, foot: null })

        return
      }
      if (target === null) return
      drag = target
      redraw({ hover: null, foot: null })

      return
    }
    // The cell a press here would land on lights; footer controls light by name.
    const nextFoot = typeof target === 'string' ? target : null
    const nextHover = target !== null && typeof target !== 'string' ? target : null
    if (hover?.row !== nextHover?.row || hover?.col !== nextHover?.col || foot !== nextFoot) {
      redraw({ hover: nextHover, foot: nextFoot })
    }
  })

  surface.onKey(e => {
    if (at.row < 0 || at.col < 0) return
    if (e.key === 'return' || e.key === 'enter' || e.key === ' ' || e.key === 'space') {
      pick(at)

      return
    }
    const step: Record<string, At> = {
      left: snapTo(at.row, at.col - 1),
      right: snapTo(at.row, at.col + 1),
      up: snapTo(at.row - 1, at.col),
      down: snapTo(at.row + 1, at.col),
    }
    const to = step[e.key]
    if (to === undefined || (to.row === at.row && to.col === at.col)) return
    pick(to)
    redraw({ hover: null })
  })

  const centre = (c: number) => c * cell + Math.floor(cell / 2)
  // How much the ember reaches a character cell: 1 on the dot, 0 past its radius.
  const glow = (r: number, x: number) => {
    if (at.row < 0 || at.col < 0) return 0
    const d = Math.hypot(x - centre(at.col), (r - at.row) * ROW_STEP)

    return Math.max(0, 1 - d / RADIUS) ** 1.25
  }
  // Each step shifts a resting ember a little, from a pattern of cell and tick.
  // The cells next to the dot hold still, so the dot never seems to move.
  const flicker = (r: number, x: number, g: number) =>
    g > 0.7 ? 0 : ((((r * 7 + x * 13 + shown.tick * 5) % 11) / 11) - 0.5) * FLICKER
  const shade = (v: number) => SHADE[clamp(Math.floor(v * SHADE.length), 0, SHADE.length - 1)] ?? CLAY
  type Run = { text: string; color: string; width: number }
  /** One effort row as runs of same-ink characters: the dots, and the ember between them. */
  const line = (r: number): Run[] => {
    const effort = efforts[r]
    const runs: Run[] = []
    const push = (text: string, color: string) => {
      const last = runs.at(-1)
      if (last !== undefined && text === ' ' && last.text.trim() === '') last.width += 1
      else runs.push({ text, color, width: 1 })
    }
    for (let x = 0; x < cell * models.length; x++) {
      const c = Math.floor(x / cell)
      const model = models[c]
      const isDot = x === centre(c)
      const g = isMine ? glow(r, x) : 0
      const v = g > 0.04 ? g + flicker(r, x, g) : 0
      if (isDot && effort !== undefined && model !== undefined) {
        if (r === at.row && c === at.col) {
          push(marks.picked, !isMine ? QUIET : effort.key === 'ultracode' ? VIOLET : CLAY)
        } else if (effort.index > model.max) push(marks.rest, OFF)
        else if (v > 0.12) push(marks.rest, shade(Math.min(1, v + 0.2)))
        else push(marks.rest, hover !== null && hover.row === r && hover.col === c ? TEXT : QUIET)
      } else if (v > 0.12) {
        push(RAMP[clamp(Math.floor(v * RAMP.length), 0, RAMP.length - 1)] ?? '.', shade(v))
      } else push(' ', OFF)
    }

    return runs
  }

  return (
    <Box flexDirection="column" width={span}>
      <Box flexDirection="row" height={1}>
        <Box width={labelWidth}>
          <Text italic color={QUIET} wrap="clip">
            Effort
          </Text>
        </Box>
        {models.map((model, c) => (
          <Box width={cell} justifyContent="center">
            <Text bold={c === at.col} color={c === at.col || hover?.col === c ? TEXT : QUIET} wrap="clip">
              {model.label}
            </Text>
          </Box>
        ))}
      </Box>
      {efforts.map((effort, r) => (
        <Box flexDirection="row" height={1}>
          <Box width={labelWidth}>
            <Text bold={r === at.row} color={r === at.row || hover?.row === r ? TEXT : QUIET} wrap="clip">
              {effort.label}
            </Text>
          </Box>
          {line(r).map(run => (
            <Box width={run.width} justifyContent="center">
              {run.text === ' ' ? null : <Text color={run.color}>{run.text}</Text>}
            </Box>
          ))}
        </Box>
      ))}
      <Box height={1} />
      <Box flexDirection="row" height={1} width={span} justifyContent="space-between">
        {hasPages ? (
          <Box width={pageWidth}>
            <Text color={foot === 'page' ? TEXT : QUIET} wrap="clip">
              {pageLabel}
            </Text>
          </Box>
        ) : (
          <Box width={1} />
        )}
        {resetWidth > 0 ? (
          <Box width={resetWidth}>
            <Text color={foot === 'reset' ? TEXT : QUIET} wrap="clip">
              {resetLabel}
            </Text>
          </Box>
        ) : (
          <Box width={1} />
        )}
      </Box>
    </Box>
  )
}

export default Grid
