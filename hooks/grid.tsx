import type { ClientModule } from 'claude-code'

// The grid: models down the side, effort levels across the top, one dot. The
// dot can be dragged anywhere between the cells and settles on the nearest one
// when let go. Around it burns an ember of ASCII marks that glimmers on its
// own, trails behind a drag, and shifts colour with the effort it is over. It
// runs on the drawing surface with no `$`: a pick is posted to the hooks module.

type Model = { key: string; label: string; max: number }
type At = { row: number; col: number }
type Foot = 'page' | 'reset'
type Slot = { col: number; lead: number; width: number; label: string }

type GridProps = {
  /** Model rows on this page, top to bottom. `max` is the last effort column allowed. */
  models: readonly Model[]
  /** How many effort columns there are. */
  cols: number
  /** The effort names, laid out by the hooks module over one to three lines. */
  head: readonly (readonly Slot[])[]
  /** The dot's row and column; a row of -1 when the session's model has no row here. */
  at: At
  isOn: boolean
  page: number
  pages: number
  labelWidth: number
  cell: number
  /** Empty cells right of the last column, for its name to run into. */
  gutter: number
  /** Screen lines per model row: 2 leaves a line between rows for the ember. */
  pitch: number
  /** True where every character is one cell wide (a terminal). */
  isMono: boolean
}

type GridState = { hover: At | null; foot: Foot | null; tick: number }
type Point = { x: number; y: number }
type Ink = { color: string; dim?: true; bold?: true }
type Run = { text: string; ink: Ink; width: number }

// Theme keys, so the grid's own inks follow the person's theme.
const TEXT = 'text'
const QUIET = 'inactive'
const OFF = 'subtle'

// The ember's colour by effort, left to right: blue for Default, then grey at
// Low warming through yellow to orange at Max, and purple for Ultracode. A mod
// cannot tell a light theme from a dark one, so every colour here reads on
// both, and heat is told by hue with `dim` and `bold`, which each theme draws
// its own way.
const EDGE = ['#8FB8EE', '#B0AEA5', '#C9C08A', '#E6CC6A', '#EDB45A', '#F0A06A', '#B3AAF0']
const CORE = ['#4F8FDB', '#8C8A82', '#B7A648', '#E0B93A', '#E8962A', '#E2701F', '#8E82E6']
const LEVELS = 10

const ASPECT = 2.4 // a screen line is about this many characters tall
const RADIUS = 5.4 // the ember's reach at rest, in character widths: round on screen
const TAIL = 1.3 // how much longer the ember trails behind a moving dot, as a share of RADIUS
const EASE = 0.5 // how much of the way to its dot the glow glides each step
const STEP_MS = 70 // the glide's clock; at rest the ember redraws every other step

const MARKS = { rest: '•', picked: '⬤', pickedMono: '●' } as const
const SETTLE_MS = 2000

const IDLE: GridState = { hover: null, foot: null, tick: 0 }
// A press and the moves after it reach this module before it has redrawn, and
// the clock runs between redraws: what they share lives here.
let drag: At | null = null
let shown: GridState = IDLE
let pending: At | null = null
let stopSettle: (() => void) | null = null
let stopClock: (() => void) | null = null
let live: { setState: (next: GridState) => void } | null = null
// The dot in flight: where it is headed, where it has got to, and its tail.
let target: Point | null = null
let head: Point | null = null
let last: Point | null = null
let beat = 0
// How hard the dot is moving, 0 to 1: it rises with speed and ebbs at rest.
// The ember swells with it, so more marks come in, coloured, as you drag.
let energy = 0
// The way the dot is moving, as a unit vector in character space; null at rest.
let heading: Point | null = null

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, (a.y - b.y) * ASPECT)
/** A steady pseudo-random share of 1 for a cell at a moment. */
const hash = (x: number, y: number, t: number) => {
  let n = (Math.imul(x + 11, 374761393) + Math.imul(y + 7, 668265263) + Math.imul(t + 3, 1274126177)) | 0
  n = Math.imul(n ^ (n >>> 13), 1103515245)

  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
/** A colour part of the way from one hex to another. */
const mix = (from: string, to: string, share: number) => {
  const part = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const blend = (at: number) =>
    Math.round(part(from, at) + (part(to, at) - part(from, at)) * share)
      .toString(16)
      .padStart(2, '0')

  return `#${blend(1)}${blend(3)}${blend(5)}`
}

/** One step of the clock: the dot glides toward where it is headed, and its tail cools. */
const step = () => {
  beat += 1
  if (target === null) {
    head = null
    last = null
  } else if (head === null || apart(head, target) < 0.4) {
    head = target
  } else {
    head = { x: head.x + (target.x - head.x) * EASE, y: head.y + (target.y - head.y) * EASE }
  }
  const moved = head !== null && last !== null ? apart(head, last) : 0
  if (moved > 0.4 && head !== null && last !== null) {
    const toward = { x: (head.x - last.x) / moved, y: ((head.y - last.y) * ASPECT) / moved }
    // The heading turns toward the new way over a few steps, so a sharp change of direction swings rather than snaps.
    if (heading === null) heading = toward
    else {
      const turn = 0.22
      const x = heading.x + (toward.x - heading.x) * turn
      const y = heading.y + (toward.y - heading.y) * turn
      const length = Math.hypot(x, y) || 1
      heading = { x: x / length, y: y / length }
    }
  }
  last = head
  // Rises fast with movement, falls back slowly once still.
  energy = moved > 0.4 ? Math.min(1, energy + moved * 0.09) : energy * 0.88
  if (energy < 0.02) energy = 0
  const isMoving = head !== target || energy > 0
  if (!isMoving && beat % 2 !== 0) return
  shown = { ...shown, tick: shown.tick + 1 }
  live?.setState(shown)
}

/** The mark a cell of the ember wears: denser toward the dot, with rays on the way out. */
const glyphFor = (level: number, dx: number, dy: number) => {
  if (level <= 0) return '.'
  if (level === 1) return ':'
  if (level >= 8) return '#'
  if (level === 7) return '*'
  if (level === 6) return '+'
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ay < ax * 0.45) return level >= 4 ? '=' : '-'
  if (ax < ay * 0.45) return level >= 3 ? '|' : "'"
  if (level === 2) return '~'
  if (level === 5) return 'x'

  return dx > 0 === dy < 0 ? '/' : '\\'
}

const Grid: ClientModule<GridProps, GridState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { models, cols, labelWidth, cell, pitch, isMono } = props
  const width = cell * cols
  const span = labelWidth + width
  const field = span + props.gutter
  // Screen lines: the effort names, a blank line, the models, a blank line, the footer.
  const top = props.head.length + 1
  const gridLines = (models.length - 1) * pitch + 1
  const footLine = top + gridLines + 1
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

  // A new instance starts clean, and starts the ember's clock once.
  const isFirst = surface.state === undefined
  if (isFirst) {
    drag = null
    pending = null
    head = null
    last = null
    energy = 0
    heading = null
    stopSettle?.()
    stopSettle = null
    stopClock?.()
    stopClock = surface.every(STEP_MS, step)
  }
  live = surface
  shown = surface.state ?? IDLE
  const { hover, foot } = shown

  if (pending !== null && props.at.row === pending.row && props.at.col === pending.col) pending = null
  // The cell that is picked, or that a drag would pick if let go now.
  const at: At = drag ?? pending ?? props.at
  const isMine = props.isOn || drag !== null || pending !== null
  const centre = (col: number) => col * cell + Math.floor(cell / 2)
  // At rest the dot heads for its cell; in a drag it heads for the pointer.
  if (drag === null) target = at.row >= 0 && at.col >= 0 ? { x: centre(at.col), y: at.row * pitch } : null
  if (isFirst || target === null) {
    head = target
    last = target
  }
  // Where the dot is drawn: a whole cell on the way to where it is headed.
  const dot =
    head === null ? null : { x: clamp(Math.round(head.x), 1, width - 2), y: clamp(Math.round(head.y), 0, gridLines - 1) }

  // The ember's inks, edge to core, for the effort the dot is over: between two
  // columns they are a blend of both, so the colour shifts as the dot travels.
  const over = head === null ? 0 : clamp((head.x - Math.floor(cell / 2)) / cell, 0, cols - 1)
  const low = clamp(Math.floor(over), 0, EDGE.length - 1)
  const high = clamp(low + 1, 0, EDGE.length - 1)
  const edge = mix(EDGE[low] ?? '#000000', EDGE[high] ?? '#000000', over - low)
  const core = mix(CORE[low] ?? '#000000', CORE[high] ?? '#000000', over - low)
  const ramp: Ink[] = Array.from({ length: LEVELS }, (_, level) => {
    // The session's own setting, before any pick, burns with no colour.
    if (!isMine) return level < 3 ? { color: OFF } : level < 7 ? { color: QUIET, dim: true } : { color: QUIET }
    // The outer marks lift toward a pale yellow, so an orange edge reads as
    // yellow-cream at the rim and deepens to its own hue at the core.
    const outer = 1 - level / (LEVELS - 1)
    const color = mix(mix(edge, '#FFF0B3', 0.5 * outer), core, level / (LEVELS - 1))

    return level === LEVELS - 1 ? { color, bold: true } : { color }
  })

  // A level a model does not offer is pulled back to the last one it has.
  const snapTo = (row: number, col: number): At => {
    const r = clamp(row, 0, models.length - 1)

    return { row: r, col: clamp(col, 0, Math.min(models[r]?.max ?? 0, cols - 1)) }
  }
  /** The model row at a height, or -1 around them. A row owns half a pitch either side. */
  const rowAt = (y: number, isFine: boolean) => {
    const from = y - top
    if (from < 0 || from >= gridLines) return -1

    return clamp(Math.floor(isFine ? (from + (pitch - 1) / 2) / pitch : from / pitch), 0, models.length - 1)
  }
  const under = (x: number, y: number, isFine: boolean): At | Foot | null => {
    if (Math.floor(y) === footLine) {
      if (hasPages && x >= 0 && x < pageWidth) return 'page'
      if (resetWidth > 0 && x >= span - resetWidth && x < span) return 'reset'

      return null
    }
    const row = rowAt(y, isFine)
    if (row < 0 || x < 0 || x >= span) return null
    // A model's name keeps the effort column the dot is in.
    const col = x < labelWidth ? Math.max(0, at.col) : Math.floor((x - labelWidth) / cell)

    return snapTo(row, col)
  }
  /** Where the pointer is inside the dots' area, kept within it, and the cell nearest to that. */
  const grab = (x: number, y: number, isFine: boolean) => {
    const point = {
      x: clamp(Math.floor(x) - labelWidth, 1, width - 2),
      y: clamp(isFine ? Math.round(y - 0.5) - top : Math.floor(y) - top, 0, gridLines - 1),
    }

    return { point, cell: snapTo(Math.round(point.y / pitch), Math.floor(point.x / cell)) }
  }

  const pick = (to: At) => {
    const model = models[to.row]
    if (model === undefined) return
    const isSame = props.isOn && to.row === props.at.row && to.col === props.at.col
    if (isSame && pending === null) return
    pending = to
    surface.post({ model: model.key, col: to.col })
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
  /** The dot follows the pointer: at once when it is close, by a glide when it is far. */
  const follow = (point: Point) => {
    target = point
    if (head === null || apart(head, point) <= 5) head = point
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
      // Let go: the dot settles on the nearest cell it may sit in.
      target = { x: centre(to.col), y: to.row * pitch }
      pick(to)
      redraw({ hover: null, foot: null })

      return
    }
    const isFine = e.fine !== undefined
    const x = e.fine?.x ?? e.x
    const y = e.fine?.y ?? e.y
    // A move with no button held means the release was missed: the press is over.
    if (drag !== null && e.type === 'move' && e.button === undefined) drag = null
    if (drag !== null && e.type === 'move') {
      const held = grab(x, y, isFine)
      drag = held.cell
      follow(held.point)
      redraw({ hover: null, foot: null })

      return
    }
    if (e.type === 'move' && e.button !== undefined) return
    const hit = under(x, y, isFine)
    if (e.type === 'down') {
      if (e.button !== undefined && e.button !== 'left') return
      if (typeof hit === 'string') {
        press(hit)
        redraw({ hover: null, foot: null })

        return
      }
      if (hit === null) return
      if (x < labelWidth) {
        // A model's name is a plain pick: there is nothing to drag there.
        pick(hit)
        redraw({ hover: null, foot: null })

        return
      }
      const held = grab(x, y, isFine)
      drag = held.cell
      follow(held.point)
      redraw({ hover: null, foot: null })

      return
    }
    // The cell a press here would land on lights; footer controls light by name.
    const nextFoot = typeof hit === 'string' ? hit : null
    const nextHover = hit !== null && typeof hit !== 'string' ? hit : null
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
    const to = {
      left: snapTo(at.row, at.col - 1),
      right: snapTo(at.row, at.col + 1),
      up: snapTo(at.row - 1, at.col),
      down: snapTo(at.row + 1, at.col),
    }[e.key]
    if (to === undefined || (to.row === at.row && to.col === at.col)) return
    pick(to)
    redraw({ hover: null })
  })

  /** How hot a cell is, 0 to 1: the glow where the dot has got to, and the tail behind it. */
  const heat = (x: number, y: number) => {
    if (head === null) return 0
    // The ember keeps its size across the way of travel. Along it, it grows a
    // tail behind the dot and stays short ahead, so it follows the dot instead
    // of swelling around it.
    const shape = (from: Point, at: number) => {
      const dx = x - from.x
      const dy = (y - from.y) * ASPECT
      if (heading === null || energy === 0) return Math.max(0, 1 - Math.hypot(dx, dy) / (RADIUS * at))
      const along = dx * heading.x + dy * heading.y
      const across = -dx * heading.y + dy * heading.x
      const length = along < 0 ? RADIUS * (1 + TAIL * energy) : RADIUS * (1 - 0.12 * energy)
      const width = RADIUS * (1 - 0.12 * energy)

      return Math.max(0, 1 - Math.hypot(along / length, across / width) * (RADIUS / (RADIUS * at)))
    }
    const most = shape(head, 1)

    return most
  }
  /** One cell of the ember, or null where it does not reach. */
  const ember = (x: number, y: number): { text: string; ink: Ink } | null => {
    const origin = head
    const hot = heat(x, y)
    if (origin === null || hot <= 0.07) return null
    const level = Math.min(LEVELS - 1, Math.floor(hot * LEVELS))
    const dx = x - origin.x
    const dy = (y - origin.y) * ASPECT
    // Colour moves every step: a ripple running outward, and now and then a spark.
    const ripple = level >= LEVELS - 2 ? 0 : Math.round(1.3 * Math.sin(Math.hypot(dx, dy) * 1.15 - shown.tick * 0.9))
    const isSpark = level < LEVELS - 3 && hash(x, y, shown.tick) < 0.04
    // In motion the outer marks run warmer, so the ones coming in arrive coloured, not faint.
    const warm = level < LEVELS - 3 ? Math.round(energy * 3) : 0
    const ink = ramp[isSpark ? LEVELS - 1 : clamp(level + ripple + warm, 0, LEVELS - 1)] ?? { color: QUIET }
    // The mark is fixed by where the cell sits in the ember; only its colour moves.
    const text = glyphFor(level, dx, dy)

    return { text, ink }
  }
  /** One screen line of the dots' area as runs: the dots, the ember between them, and the gaps. */
  const lineOf = (y: number): Run[] => {
    const row = y >= 0 && y < gridLines && y % pitch === 0 ? y / pitch : -1
    const model = row < 0 ? undefined : models[row]
    const runs: Run[] = []
    const gap = () => {
      const before = runs.at(-1)
      if (before !== undefined && before.text === '') before.width += 1
      else runs.push({ text: '', ink: { color: OFF }, width: 1 })
    }
    for (let x = 0; x < width; x++) {
      // The dot itself is large: it takes the cell either side of its own, and nothing else goes there.
      if (dot !== null && y === dot.y && x === dot.x - 1) {
        runs.push({
          text: isMono ? MARKS.pickedMono : MARKS.picked,
          ink: { color: isMine ? core : QUIET },
          width: 3,
        })
        x += 2
        continue
      }
      const col = Math.floor(x / cell)
      const glow = ember(x, y)
      if (model !== undefined && x === centre(col)) {
        const isLit = (drag ?? hover)?.row === row && (drag ?? hover)?.col === col
        const ink: Ink =
          col > model.max ? { color: OFF } : isLit ? { color: TEXT } : glow !== null ? { color: glow.ink.color } : { color: QUIET }
        runs.push({ text: MARKS.rest, ink, width: 1 })
      } else if (glow !== null) {
        runs.push({ text: glow.text, ink: glow.ink, width: 1 })
      } else gap()
    }

    return runs
  }

  return (
    <Box flexDirection="column" width={field}>
      {props.head.map(slots => (
        <Box flexDirection="row" height={1} width={field}>
          {slots.flatMap(slot => [
            <Box width={slot.lead} />,
            <Box width={slot.width} justifyContent="center">
              <Text
                bold={slot.col === at.col}
                color={slot.col === at.col || hover?.col === slot.col ? TEXT : QUIET}
                wrap="clip"
              >
                {slot.label}
              </Text>
            </Box>,
          ])}
        </Box>
      ))}
      {Array.from({ length: gridLines + 2 }, (_, line) => {
        // One line above the first row and one below the last hold only the ember.
        const y = line - 1
        const row = y >= 0 && y < gridLines && y % pitch === 0 ? y / pitch : -1
        const model = row < 0 ? undefined : models[row]

        return (
          <Box flexDirection="row" height={1}>
            <Box width={labelWidth}>
              {model === undefined ? null : (
                <Text bold={row === at.row} color={row === at.row || hover?.row === row ? TEXT : QUIET} wrap="clip">
                  {model.label}
                </Text>
              )}
            </Box>
            {lineOf(y).map(run => (
              <Box width={run.width} justifyContent="center">
                {run.text === '' ? null : (
                  <Text color={run.ink.color} dimColor={run.ink.dim === true} bold={run.ink.bold === true} wrap="clip">
                    {run.text}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        )
      })}
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
