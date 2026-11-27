import type { ClientModule } from 'claude-code'

// The grid: one dark card, models down the side, effort across the top, one
// dot. It runs on the drawing surface with no `$`; a pick is posted to the
// hooks module when the pointer lets go, on a click, or on a key.

type Row = { key: string; label: string; max: number }
type At = { row: number; col: number }

type GridProps = {
  rows: readonly Row[]
  cols: readonly string[]
  /** The full name of each column, for the readout. */
  levels: readonly string[]
  at: At
  isUltra: boolean
  /** False while the dot only mirrors the session and the mod changes nothing. */
  isOn: boolean
  /** Whether a More models row is drawn, and which way it points. */
  hasMore: boolean
  isExpanded: boolean
  labelWidth: number
  cell: number
}

type GridState = { at: At; hover: At | null; hoverLine: 'more' | 'ultra' | null; isUltra: boolean }

// The card keeps the mockup's dark surfaces in either app theme.
const PANEL = '#30302E'
const FIELD = '#1F1E1D'
const LIFT = '#3D3B38'
const PICKED = '#4A2E24'
const TEXT = '#FAF9F5'
const SOFT = '#C2C0B6'
const QUIET = '#8C8A82'
const OFF = '#45423F'
const CLAY = '#D97757'
const VIOLET = '#A096EB'

const PAD_X = 2
const TOP = 5 // screen row of the first model row
const PITCH = 2 // screen rows per model row

// A press and the moves after it reach this module before it has redrawn, so
// what the drag knows lives here, not in a render's closure.
let isDragging = false
let latest: At | null = null
// The pick just posted, shown until the hooks module's props catch up with it.
let pending: { key: string; col: number } | null = null

const Grid: ClientModule<GridProps, GridState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, cols, levels, labelWidth, cell } = props
  const now: GridState = surface.state ?? {
    at: props.at,
    hover: null,
    hoverLine: null,
    isUltra: props.isUltra,
  }
  if (pending !== null && rows[props.at.row]?.key === pending.key && props.at.col === pending.col) {
    pending = null
  }
  const waiting = pending === null ? -1 : rows.findIndex(row => row.key === pending?.key)
  const at: At =
    isDragging && latest !== null
      ? latest
      : pending !== null && waiting >= 0
        ? { row: waiting, col: pending.col }
        : props.at
  const { hover, hoverLine } = now
  const moreRow = TOP + rows.length * PITCH
  const ultraRow = props.hasMore ? moreRow + PITCH : moreRow

  const snap = (row: number, col: number): At => {
    const r = Math.max(0, Math.min(rows.length - 1, row))
    const c = Math.max(0, Math.min(rows[r]?.max ?? 0, col, cols.length - 1))

    return { row: r, col: c }
  }
  const cellAt = (x: number, y: number): At =>
    snap(Math.round((y - TOP) / PITCH), Math.floor((x - PAD_X - labelWidth) / cell))
  const lineAt = (y: number) => {
    if (props.hasMore && Math.abs(y - moreRow) < 1) return 'more' as const
    if (Math.abs(y - ultraRow) < 1) return 'ultra' as const

    return null
  }
  const pick = (to: At, isUltra: boolean) => {
    const row = rows[to.row]
    if (row === undefined) return
    pending = { key: row.key, col: to.col }
    surface.post({ model: row.key, col: to.col, isUltra })
  }

  surface.onPointer(e => {
    if (e.type === 'enter') return
    if (e.type === 'leave') {
      if (hover !== null || hoverLine !== null) surface.setState({ ...now, at, hover: null, hoverLine: null })

      return
    }
    if (e.type === 'up') {
      if (isDragging) {
        isDragging = false
        pick(latest ?? at, now.isUltra)
      }

      return
    }
    const x = e.fine?.x ?? e.x
    const y = e.fine?.y ?? e.y
    const line = y > TOP + (rows.length - 1) * PITCH + 1 ? lineAt(y) : null

    if (e.type === 'down' && line === 'more') {
      surface.post({ expand: !props.isExpanded })

      return
    }
    if (e.type === 'down' && line === 'ultra') {
      surface.setState({ ...now, at, isUltra: !now.isUltra })
      pick(at, !now.isUltra)

      return
    }
    if (e.type === 'down' && line === null) isDragging = true
    if (isDragging) {
      const to = cellAt(x, y)
      if (latest?.row !== to.row || latest.col !== to.col || e.type === 'down') {
        latest = to
        surface.setState({ ...now, at: to, hover: null, hoverLine: null })
      }

      return
    }
    // A hover: light the cell or the line under the pointer.
    if (line !== null) {
      if (hoverLine !== line) surface.setState({ ...now, at, hover: null, hoverLine: line })

      return
    }
    const to = cellAt(x, y)
    if (hover?.row !== to.row || hover.col !== to.col || hoverLine !== null) {
      surface.setState({ ...now, at, hover: to, hoverLine: null })
    }
  })

  surface.onKey(e => {
    const step: Record<string, At> = {
      left: snap(at.row, at.col - 1),
      right: snap(at.row, at.col + 1),
      up: snap(at.row - 1, at.col),
      down: snap(at.row + 1, at.col),
    }
    const to = step[e.key]
    if (to === undefined) return
    latest = to
    surface.setState({ ...now, at: to, hover: null, hoverLine: null })
    pick(to, now.isUltra)
  })

  const mark = (row: number, col: number) => {
    const isHere = row === at.row && col === at.col
    const isHover = hover !== null && hover.row === row && hover.col === col
    if (isHere) return { glyph: '●', color: CLAY, back: PICKED }
    if (col > (rows[row]?.max ?? 0)) return { glyph: '·', color: OFF, back: FIELD }
    if (isHover) return { glyph: '○', color: CLAY, back: LIFT }
    // The row and column under the pointer light up, like a crosshair.
    const isCross = hover !== null && (hover.row === row || hover.col === col)
    // Default is the "leave it to Claude" lane: hollow rings.
    if (col === 0) return { glyph: '○', color: isCross ? SOFT : QUIET, back: FIELD }
    if (row === at.row || col === at.col || isCross) return { glyph: '•', color: SOFT, back: FIELD }

    return { glyph: '·', color: QUIET, back: FIELD }
  }

  const here = rows[at.row]
  const width = labelWidth + cell * cols.length

  return (
    <Box flexDirection="column" backgroundColor={PANEL} paddingX={PAD_X} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between" width={width}>
        <Text bold color={TEXT}>
          {here?.label ?? ''}
        </Text>
        <Box flexDirection="row" gap={1}>
          {now.isUltra && <Text color={VIOLET}>Ultracode</Text>}
          <Text bold color={props.isOn || isDragging ? CLAY : QUIET}>
            {levels[at.col] ?? ''}
          </Text>
        </Box>
      </Box>
      <Box height={1} />
      <Box flexDirection="column" backgroundColor={FIELD} width={width}>
        <Box flexDirection="row">
          <Box width={labelWidth} />
          {cols.map((label, col) => (
            <Box width={cell} justifyContent="center">
              <Text
                bold={col === at.col}
                color={col === at.col ? TEXT : hover?.col === col ? SOFT : QUIET}
              >
                {label}
              </Text>
            </Box>
          ))}
        </Box>
        <Box height={1} />
        {rows.map((row, r) => (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Box width={labelWidth} paddingLeft={1}>
                <Text
                  bold={r === at.row}
                  color={r === at.row ? TEXT : hover?.row === r ? SOFT : QUIET}
                >
                  {row.label}
                </Text>
              </Box>
              {cols.map((_, col) => {
                const { glyph, color, back } = mark(r, col)

                return (
                  <Box width={cell} justifyContent="center" backgroundColor={back}>
                    <Text color={color}>{glyph}</Text>
                  </Box>
                )
              })}
            </Box>
            <Box height={PITCH - 1} />
          </Box>
        ))}
      </Box>
      {props.hasMore && (
        <Box flexDirection="column" width={width}>
          <Box paddingLeft={1} backgroundColor={hoverLine === 'more' ? LIFT : PANEL}>
            <Text color={hoverLine === 'more' ? TEXT : SOFT}>
              {props.isExpanded ? '▾ Fewer models' : '▸ More models'}
            </Text>
          </Box>
          <Box height={PITCH - 1} />
        </Box>
      )}
      <Box paddingLeft={1} width={width} backgroundColor={hoverLine === 'ultra' ? LIFT : PANEL}>
        <Box flexDirection="row" gap={1}>
          <Text color={now.isUltra ? VIOLET : QUIET}>{now.isUltra ? '●' : '○'}</Text>
          <Text bold={now.isUltra} color={now.isUltra ? VIOLET : hoverLine === 'ultra' ? TEXT : SOFT}>
            Ultracode {now.isUltra ? 'on' : 'off'}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

export default Grid
