import type { ClientModule } from 'claude-code'

// The draggable grid. It runs on the drawing surface with no `$`: everything it
// knows arrives as props. While the dot is dragged nothing leaves this module,
// so the dot follows the pointer with no round trip; the choice is posted to
// the hooks module when the pointer lets go, or on a key.

type At = { row: number; col: number }

type GridProps = {
  rows: readonly string[]
  cols: readonly string[]
  /** The full name of each column, for the readout. */
  levels: readonly string[]
  /** For each row, the last column the dot may sit in. */
  max: readonly number[]
  at: At
  isUltra: boolean
  /** False while the dot only mirrors the session and the mod changes nothing. */
  isOn: boolean
  labelWidth: number
  cell: number
}

type GridState = { at: At; hover: At | null; isUltra: boolean; isDragging: boolean }

const TOP = 3 // screen row of the first model row
const PITCH = 2 // screen rows per model row
const VIOLET = '#8173E3'

const Grid: ClientModule<GridProps, GridState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { rows, cols, levels, max, labelWidth, cell } = props
  const now: GridState = surface.state ?? {
    at: props.at,
    hover: null,
    isUltra: props.isUltra,
    isDragging: false,
  }
  const { at, hover } = now
  const toggleRow = TOP + rows.length * PITCH

  const snap = (row: number, col: number): At => {
    const r = Math.max(0, Math.min(rows.length - 1, row))
    const c = Math.max(0, Math.min(max[r] ?? 0, col))

    return { row: r, col: c }
  }

  const cellAt = (x: number, y: number): At =>
    snap(Math.round((y - TOP) / PITCH), Math.floor((x - labelWidth) / cell))

  const send = (to: GridState) => {
    surface.post({ row: to.at.row, col: to.at.col, isUltra: to.isUltra })
  }

  surface.onPointer(e => {
    if (e.type === 'leave') {
      if (hover !== null) surface.setState({ ...now, hover: null })

      return
    }
    if (e.type === 'enter') return
    if (e.type === 'up') {
      if (now.isDragging) {
        surface.setState({ ...now, isDragging: false })
        send(now)
      }

      return
    }
    const y = e.fine?.y ?? e.y
    if (e.type === 'down' && y >= toggleRow - 0.5) {
      const to = { ...now, isUltra: !now.isUltra, hover: null }
      surface.setState(to)
      send(to)

      return
    }
    const to = cellAt(e.fine?.x ?? e.x, y)
    if (e.type === 'down' || (e.button !== undefined && now.isDragging)) {
      if (!now.isDragging || to.row !== at.row || to.col !== at.col) {
        surface.setState({ ...now, at: to, hover: null, isDragging: true })
      }

      return
    }
    if (hover?.row !== to.row || hover.col !== to.col) surface.setState({ ...now, hover: to })
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
    const next = { ...now, at: to, hover: null }
    surface.setState(next)
    send(next)
  })

  const mark = (row: number, col: number) => {
    if (row === at.row && col === at.col) return { glyph: '●', color: 'claude' }
    if (col > (max[row] ?? 0)) return { glyph: ' ', color: 'subtle' }
    if (hover !== null && hover.row === row && hover.col === col) {
      return { glyph: '○', color: 'claude' }
    }
    // Default is the "leave it to Claude" lane: hollow rings.
    if (col === 0) return { glyph: '○', color: 'inactive' }
    // Like a rook's legal moves: the dots in line with the selection stand out.
    if (row === at.row || col === at.col) return { glyph: '•', color: 'inactive' }

    return { glyph: '·', color: 'inactive' }
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold>{rows[at.row] ?? ''}</Text>
        <Text color="claude">{levels[at.col] ?? ''}</Text>
        {now.isUltra && <Text color={VIOLET}>Ultracode</Text>}
        {!props.isOn && !now.isDragging && <Text dimColor>(session setting)</Text>}
      </Box>
      <Box height={1} />
      <Box flexDirection="row">
        <Box width={labelWidth} />
        {cols.map((label, col) => (
          <Box width={cell} justifyContent="center">
            <Text bold={col === at.col} color={col === at.col ? 'text' : 'inactive'}>
              {label}
            </Text>
          </Box>
        ))}
      </Box>
      {rows.map((label, row) => (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Box width={labelWidth}>
              <Text bold={row === at.row} color={row === at.row ? 'text' : 'inactive'}>
                {label}
              </Text>
            </Box>
            {cols.map((_, col) => {
              const { glyph, color } = mark(row, col)

              return (
                <Box width={cell} justifyContent="center">
                  <Text color={color}>{glyph}</Text>
                </Box>
              )
            })}
          </Box>
          <Box height={PITCH - 1} />
        </Box>
      ))}
      <Box flexDirection="row" gap={1}>
        <Text color={now.isUltra ? VIOLET : 'inactive'}>{now.isUltra ? '●' : '○'}</Text>
        <Text bold={now.isUltra} color={now.isUltra ? VIOLET : 'inactive'}>
          Ultracode {now.isUltra ? 'on' : 'off'}
        </Text>
      </Box>
    </Box>
  )
}

export default Grid
