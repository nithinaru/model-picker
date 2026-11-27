import type { ClientModule } from 'claude-code'

// The grid: models down the side, effort across the top, one dot, drawn on the
// pane's own surface in the theme's own inks. It runs on the drawing surface
// with no `$`; a pick is posted to the hooks module when the pointer lets go,
// on a click, or on a key.

type Row = { key: string; label: string; max: number; isOlder: boolean }
type At = { row: number; col: number }
type Foot = 'more' | 'reset'

type GridProps = {
  rows: readonly Row[]
  /** Each column's name, written out. */
  cols: readonly string[]
  /** A shorter name per column, for a pane too narrow for the full ones. */
  shortCols: readonly string[]
  /** What a column means, shown while the pointer is on it; empty for a plain level. */
  hints: readonly string[]
  /** The dot's cell; a row of -1 when the session's model has no row. */
  at: At
  /** False while the dot only mirrors the session and the mod changes nothing. */
  isOn: boolean
  isExpanded: boolean
  /** How many older models are folded away. */
  moreCount: number
  labelWidth: number
  cell: number
  /** Empty cells right of the last column, for its name to run into. */
  gutter: number
  /** True where every character is one cell wide (a terminal). */
  isMono: boolean
}

type GridState = {
  hover: At | null
  /** The footer control under the pointer. */
  foot: Foot | null
  /** The footer control the arrow keys are on. */
  focus: Foot | null
  tick: number
}

// Theme keys, so every ink follows the person's theme, light or dark. There is
// no fill: the pane's own surface shows through.
const TEXT = 'text'
const QUIET = 'inactive'
const OFF = 'subtle'
const CLAY = 'claude'
// No theme key is violet. This one is a mark's contrast (3:1) from both a white
// surface and the app's dark one.
const VIOLET = '#9488E6'

// Every cell is the same filled disc; the picked one is the same disc, larger.
// A terminal gets marks that are one cell wide in every font.
const MARKS = { desktop: { rest: '●', picked: '⬤' }, mono: { rest: '•', picked: '●' } } as const

const AXIS = 'Effort'
const RESET = 'Use session model'
const RESET_SHORT = 'Use session'
// A proportional face sets a name in about this share of its character cells:
// used only to judge whether two names have a visible gap between them.
const SET_WIDTH = 0.8
const SETTLE_MS = 2000

const IDLE: GridState = { hover: null, foot: null, focus: null, tick: 0 }

// A press and the moves after it reach this module before it has redrawn, so
// what the drag knows lives here, not in a render's closure.
let drag: At | null = null
let shown: GridState = IDLE
// The pick just posted, shown until the hooks module's props answer it.
// `isBack` is a pick of the cell the props still show, made over an earlier
// pick: it waits for that one's answer to come and go.
let pending: { key: string; col: number; from: string; isBack: boolean } | null = null
let stopWaiting: (() => void) | null = null
// The column the arrow keys are after, kept while a row cannot reach it.
let wish: { key: string; col: number; want: number } | null = null

type Slot = { col: number; lead: number; width: number }
type Header = { lines: Slot[][]; names: readonly string[] }

/**
 * Where the column names go: on one line when they fit, else alternating over
 * two, each in a box centred on its column's dots. One spelling for the whole
 * header: the short names only when the full ones do not fit.
 */
export const headerFor = (
  given: Pick<GridProps, 'cols' | 'shortCols' | 'labelWidth' | 'cell' | 'gutter' | 'isMono'>,
): Header => {
  const { cols, shortCols, labelWidth, cell, gutter, isMono } = given
  const field = labelWidth + cell * cols.length + gutter
  const set = (name: string) => (isMono ? name.length : name.length * SET_WIDTH)
  const centre = (col: number) => labelWidth + cell * col + cell / 2
  // A box with a cell for every character, so no face can wrap the name, odd
  // or even as the cell is, so both share a centre.
  const boxOf = (name: string) => {
    const width = Math.max(1, name.length)

    return (width - cell) % 2 === 0 ? width : width + 1
  }
  const line = (names: readonly string[], picks: number[], isForced: boolean): Slot[] | null => {
    const slots: Slot[] = []
    let x = 0
    let last: number | null = null
    for (const col of picks) {
      const name = names[col] ?? ''
      const width = boxOf(name)
      const left = Math.round(centre(col) - width / 2)
      const isClear =
        last === null || centre(col) - centre(last) - (set(name) + set(names[last] ?? '')) / 2 >= 1
      if (!isForced && (left < x || !isClear)) return null
      slots.push({ col, lead: Math.max(0, left - x), width })
      x = Math.max(x, left) + width
      last = col
    }

    return !isForced && x > field ? null : slots
  }
  const every = cols.map((_, col) => col)
  const even = every.filter(col => col % 2 === 0)
  const odd = every.filter(col => col % 2 === 1)
  const one = line(cols, every, false)
  if (one !== null) return { lines: [one], names: cols }
  const top = line(cols, even, false)
  const under = line(cols, odd, false)
  if (top !== null && under !== null) return { lines: [top, under], names: cols }

  return { lines: [line(shortCols, even, true) ?? [], line(shortCols, odd, true) ?? []], names: shortCols }
}

/** The screen row each model is drawn on: current models take two rows each, older ones one. */
const linesFor = (rows: readonly Row[], top: number) => {
  const ys: number[] = []
  let y = top
  for (const row of rows) {
    ys.push(y)
    y += row.isOlder ? 1 : 2
  }

  return ys
}

/**
 * The model row at a screen row, or null between and around them. A whole
 * row counts as the line it names: a spaced model owns its line and the blank
 * one under it. A finer position is measured from the top of a line, so a
 * spaced model owns its line and half a line either side.
 */
export const rowUnder = (rows: readonly Row[], top: number, py: number, isFine: boolean) => {
  const ys = linesFor(rows, top)
  const found = rows.findIndex((row, r) => {
    const line = ys[r] ?? 0
    if (row.isOlder) return py >= line && py < line + 1

    return isFine ? py >= line - 0.5 && py < line + 1.5 : py >= line && py < line + 2
  })

  return found < 0 ? null : found
}

const Grid: ClientModule<GridProps, GridState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, cols, labelWidth, cell, gutter } = props
  const span = labelWidth + cell * cols.length
  const lastCol = cols.length - 1
  const lastRow = rows.length - 1

  // A new instance starts clean: nothing is left over from one that was dropped mid-press.
  if (surface.state === undefined) {
    drag = null
    pending = null
    wish = null
    stopWaiting?.()
    stopWaiting = null
  }
  shown = surface.state ?? IDLE
  const { hover, foot } = shown
  const redraw = (next: Partial<GridState>) => {
    shown = { ...shown, ...next, tick: shown.tick + 1 }
    surface.setState(shown)
  }

  const sign = `${rows[props.at.row]?.key ?? ''}:${props.at.col}:${props.isOn}`
  if (pending !== null) {
    const isAnswered = props.isOn && rows[props.at.row]?.key === pending.key && props.at.col === pending.col
    if (pending.isBack) {
      if (sign !== pending.from) pending = { ...pending, from: sign, isBack: false }
    } else if (isAnswered || sign !== pending.from) {
      // Answered, or the hooks module settled on some other cell: its word stands.
      pending = null
    }
  }
  const waiting = pending === null ? -1 : rows.findIndex(row => row.key === pending?.key)
  const at: At =
    drag !== null ? drag : pending !== null && waiting >= 0 ? { row: waiting, col: pending.col } : props.at
  const isMine = props.isOn || drag !== null || pending !== null

  const header = headerFor(props)
  // Screen rows: the names, a blank line, the models, the hint line, a blank line, the footer.
  const top = header.lines.length + 1
  const ys = linesFor(rows, top)
  const footRow = (ys[lastRow] ?? top) + 3
  const field = span + gutter
  // The footer ends where the grid does: under the last name or the last cell.
  const tail = header.lines.flat().find(slot => slot.col === lastCol)
  const edge = Math.min(field, Math.max(span, tail === undefined ? 0 : Math.round(span - cell / 2 + tail.width / 2)))

  const moreLabel = props.isExpanded ? 'Fewer models' : `${props.moreCount} more models`
  const hasMore = props.isExpanded || props.moreCount > 0
  const hasReset = props.isOn
  const moreWidth = hasMore ? moreLabel.length : 0
  // A grid too narrow for both labels with a gap between gets the shorter one.
  const resetLabel = moreWidth + RESET.length + 2 > edge ? RESET_SHORT : RESET
  const resetWidth = resetLabel.length
  // The keys cannot stay on a control that is no longer drawn.
  const focus = (shown.focus === 'reset' && !hasReset) || (shown.focus === 'more' && !hasMore) ? null : shown.focus
  if (focus !== shown.focus) shown = { ...shown, focus }

  const snap = (row: number, col: number): At => {
    const r = Math.max(0, Math.min(lastRow, row))
    const c = Math.max(0, Math.min(rows[r]?.max ?? 0, col, lastCol))

    return { row: r, col: c }
  }
  const rowAt = (py: number, isFine: boolean) => rowUnder(rows, top, py, isFine)
  /** What a press at this point would act on: a cell, a footer control, or nothing. */
  const under = (px: number, py: number, isFine: boolean): At | Foot | null => {
    const x = px
    if (Math.floor(py) === footRow) {
      if (hasMore && x >= 0 && x < moreWidth) return 'more'
      if (hasReset && x >= edge - resetWidth && x < edge) return 'reset'

      return null
    }
    const row = rowAt(py, isFine)
    if (row === null || x < 0 || x >= span) return null
    // A model's name moves the dot to that model and keeps the level.
    if (x < labelWidth) return snap(row, at.col)

    return snap(row, Math.floor((x - labelWidth) / cell))
  }
  /** The nearest cell to a point anywhere, for a drag that has left the grid. */
  const nearest = (px: number, py: number): At => {
    let row = 0
    rows.forEach((_, r) => {
      if (py >= (ys[r] ?? 0) - 0.5) row = r
    })

    return snap(row, Math.floor((px - labelWidth) / cell))
  }

  const pick = (to: At) => {
    const row = rows[to.row]
    if (row === undefined) return
    const isSame = props.isOn && to.row === props.at.row && to.col === props.at.col
    // Nothing to say, unless an earlier pick is still on its way: the last press wins.
    if (isSame && pending === null) return
    pending = { key: row.key, col: to.col, from: sign, isBack: isSame }
    surface.post({ model: row.key, col: to.col })
    // A post that is never answered must not leave a dot that is not the setting.
    stopWaiting?.()
    stopWaiting = surface.every(SETTLE_MS, () => {
      stopWaiting?.()
      stopWaiting = null
      if (pending === null) return
      pending = null
      redraw({})
    })
  }
  const press = (which: Foot) => {
    if (which === 'more') {
      surface.post({ expand: !props.isExpanded })

      return
    }
    pending = null
    wish = null
    surface.post({ reset: true })
  }

  surface.onPointer(e => {
    if (e.type === 'enter') return
    if (e.type === 'leave') {
      // A held press keeps the pointer past the edge: the drag goes on until the release.
      if (drag === null && (hover !== null || foot !== null)) redraw({ hover: null, foot: null })

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
    const isFine = e.fine !== undefined
    const px = e.fine?.x ?? e.x
    const py = e.fine?.y ?? e.y
    // A move with no button held means the release was missed: the press is over.
    if (drag !== null && e.type === 'move' && e.button === undefined) drag = null
    if (drag !== null && e.type === 'move') {
      const to = nearest(px, py)
      if (drag.row !== to.row || drag.col !== to.col) {
        drag = to
        redraw({ hover: null, foot: null })
      }

      return
    }
    // A button held with no dot in hand lights nothing.
    if (e.type === 'move' && e.button !== undefined) return
    const target = under(px, py, isFine)
    if (e.type === 'down') {
      if (e.button !== undefined && e.button !== 'left') return
      if (target === 'more' || target === 'reset') {
        press(target)
        redraw({ hover: null, focus: null })

        return
      }
      if (target === null) return
      drag = target
      wish = null
      redraw({ hover: null, foot: null, focus: null })

      return
    }
    // The cell a press here would land on lights, and nothing else does.
    const nextFoot = target === 'more' || target === 'reset' ? target : null
    const nextHover = target === null || nextFoot !== null ? null : (target as At)
    if (hover?.row !== nextHover?.row || hover?.col !== nextHover?.col || foot !== nextFoot) {
      redraw({ hover: nextHover, foot: nextFoot })
    }
  })

  surface.onKey(e => {
    const isEnter = e.key === 'return' || e.key === 'enter' || e.key === ' ' || e.key === 'space'
    if (focus !== null) {
      // On the footer line: across between its controls, up to the grid, Enter to press.
      if (isEnter) press(focus)
      else if (e.key === 'up') redraw({ focus: null })
      else if (e.key === 'left' && hasMore) redraw({ focus: 'more' })
      else if (e.key === 'right' && hasReset) redraw({ focus: 'reset' })

      return
    }
    if (isEnter) {
      if (!props.isOn) {
        pending = null
        pick(at)
        redraw({ hover: null })
      }

      return
    }
    const here = rows[at.row]
    const want = wish !== null && wish.key === here?.key && wish.col === at.col ? wish.want : at.col
    if (e.key === 'down' && at.row === lastRow) {
      const to = hasMore ? 'more' : hasReset ? 'reset' : null
      if (to !== null) redraw({ hover: null, focus: to })

      return
    }
    const step: Record<string, At> = {
      left: snap(at.row, at.col - 1),
      right: snap(at.row, at.col + 1),
      up: snap(at.row - 1, want),
      down: snap(at.row + 1, want),
    }
    const to = step[e.key]
    if (to === undefined || (to.row === at.row && to.col === at.col)) return
    const landed = rows[to.row]
    if (landed === undefined) return
    // Across sets the level being asked for; up and down only carry it along.
    wish = { key: landed.key, col: to.col, want: e.key === 'left' || e.key === 'right' ? to.col : want }
    pick(to)
    redraw({ hover: null })
  })

  const marks = props.isMono ? MARKS.mono : MARKS.desktop
  // Clay or violet only for a pick of the person's own: the session's is neutral.
  const dot = (row: number, col: number) => {
    if (row === at.row && col === at.col) {
      return { glyph: marks.picked, color: !isMine ? QUIET : col === lastCol ? VIOLET : CLAY }
    }
    if (col > (rows[row]?.max ?? 0)) return { glyph: marks.rest, color: OFF }
    if (hover !== null && hover.row === row && hover.col === col) return { glyph: marks.rest, color: TEXT }

    return { glyph: marks.rest, color: QUIET }
  }
  // Every Text is cut at its box, never wrapped: a wrapped name would move the rows under it.
  const names = (slots: Slot[], isFirst: boolean) => {
    const lead = slots[0]?.lead ?? 0

    return (
      <Box flexDirection="row" width={field} height={1}>
        <Box width={lead}>
          {isFirst && lead > AXIS.length ? (
            <Text italic color={QUIET} wrap="clip">
              {AXIS}
            </Text>
          ) : null}
        </Box>
        {slots.flatMap((slot, i) => {
          const isLit = slot.col === at.col || hover?.col === slot.col
          const name = (
            <Box width={slot.width} justifyContent="center">
              <Text bold={slot.col === at.col} color={isLit ? TEXT : QUIET} wrap="clip">
                {header.names[slot.col] ?? ''}
              </Text>
            </Box>
          )

          return i > 0 && slot.lead > 0 ? [<Box width={slot.lead} />, name] : [name]
        })}
      </Box>
    )
  }
  // Hover lights the label; the arrow keys underline it as well.
  const control = (which: Foot, label: string, room: number) => (
    <Box width={room} justifyContent={which === 'reset' ? 'flex-end' : 'flex-start'}>
      <Text color={foot === which || focus === which ? TEXT : QUIET} underline={focus === which} wrap="clip">
        {label}
      </Text>
    </Box>
  )
  const hint = hover === null ? '' : (props.hints[hover.col] ?? '')
  // Under the columns it speaks of, where it fits there; else from the left edge.
  const hintLead = hint.length <= field - labelWidth ? labelWidth : 0

  return (
    <Box flexDirection="column" width={field}>
      {header.lines.map((slots, i) => names(slots, i === 0))}
      <Box height={1} />
      {rows.map((row, r) => (
        <Box flexDirection="column">
          <Box flexDirection="row" height={1}>
            <Box width={labelWidth}>
              <Text
                bold={r === at.row}
                color={r === at.row || hover?.row === r || !row.isOlder ? TEXT : QUIET}
                wrap="clip"
              >
                {row.label}
              </Text>
            </Box>
            {cols.map((_, col) => {
              const { glyph, color } = dot(r, col)

              return (
                <Box width={cell} justifyContent="center">
                  <Text color={color}>{glyph}</Text>
                </Box>
              )
            })}
          </Box>
          {row.isOlder || r === lastRow ? null : <Box height={1} />}
        </Box>
      ))}
      <Box flexDirection="row" height={1} width={field}>
        <Box width={hintLead} />
        {hint === '' ? null : (
          <Box width={field - hintLead}>
            <Text color={QUIET} wrap="truncate-end">
              {hint}
            </Text>
          </Box>
        )}
      </Box>
      <Box height={1} />
      <Box flexDirection="row" justifyContent="space-between" width={edge} height={1}>
        {hasMore ? control('more', moreLabel, moreWidth) : <Box width={1} />}
        {hasReset ? control('reset', resetLabel, resetWidth) : <Box width={1} />}
      </Box>
    </Box>
  )
}

export default Grid
