import { writeFileSync } from 'node:fs'

// Draws the grid to an HTML page without the app, so its look can be checked
// by eye. `npx tsx tools/preview.ts` writes a page of states; `--demo` writes
// the strip of frames the readme's animation is cut from. Cells are sized as
// the desktop app's, and text is set in the app's own typeface when Claude is
// installed; the app remains the final word.
type Node = { type: string; props: Record<string, unknown>; children: unknown[] } | string | null | false
type Pointer = { type: string; x: number; y: number; button?: string }

;(globalThis as Record<string, unknown>).h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) =>
  typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat(9) }

const CW = 8.8
const RH = 22
const FONTS = '/Applications/Claude.app/Contents/Resources/fonts'
const FACE = `<style>
@font-face { font-family: 'Anthropic Sans'; font-style: normal; font-weight: 300 800; src: url('file://${FONTS}/AnthropicSans-Romans-Variable-25x258.ttf'); }
@font-face { font-family: 'Anthropic Sans'; font-style: italic; font-weight: 300 800; src: url('file://${FONTS}/AnthropicSans-Italics-Variable-25x258.ttf'); }
body { margin: 0; font: 13px/${RH}px 'Anthropic Sans', -apple-system, 'SF Pro Text', sans-serif; }
</style>`
// The theme keys the grid draws with, as the app's light and dark themes ink them.
const INKS: Record<string, Record<string, string>> = {
  light: { page: '#FFFFFF', text: '#141413', inactive: '#73726C', subtle: '#C2C0B6', claude: '#C6613F' },
  dark: { page: '#262624', text: '#FAF9F5', inactive: '#9C9A92', subtle: '#5C5B57', claude: '#D97757' },
}
let inks = INKS.light ?? {}
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const draw = (node: Node): string => {
  if (Array.isArray(node)) return node.map(child => draw(child as Node)).join('')
  if (node === null || node === false || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(String(node))
  const p = node.props
  const inner = node.children.map(child => draw(child as Node)).join('')
  if (node.type === 'Text') {
    const color = typeof p.color === 'string' ? (inks[p.color] ?? p.color) : 'inherit'
    const css = [
      `color:${color}`,
      p.bold ? 'font-weight:600' : '',
      p.italic ? 'font-style:italic' : '',
      p.dimColor ? 'opacity:0.5' : '',
      p.mono ? `font-family:'SF Mono',Menlo,monospace;font-size:12px` : '',
      p.wrap !== undefined && p.wrap !== 'wrap' ? 'white-space:nowrap;overflow:hidden' : '',
    ].join(';')

    return `<span style="${css}">${inner}</span>`
  }
  const css = [
    'display:flex;box-sizing:border-box;flex-shrink:0',
    `flex-direction:${p.flexDirection ?? 'row'}`,
    p.justifyContent ? `justify-content:${p.justifyContent}` : '',
    typeof p.width === 'number' ? `width:${p.width * CW}px` : '',
    typeof p.height === 'number' ? `height:${p.height * RH}px` : `min-height:${p.flexDirection === 'column' ? 0 : RH}px`,
    'align-items:' + (p.flexDirection === 'column' ? 'stretch' : 'center'),
  ].join(';')

  return `<div style="${css}">${inner}</div>`
}

const EFFORTS = ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultracode']
const SHORT = ['Def', 'Low', 'Med', 'High', 'Extra', 'Max', 'Ultra']
const MAIN = [
  { key: 'fable-5-2', label: 'Fable 5.2', max: 6 },
  { key: 'opus-5-5', label: 'Opus 5.5', max: 6 },
  { key: 'sonnet-5-5', label: 'Sonnet 5.5', max: 3 },
  { key: 'haiku-5-5', label: 'Haiku 5.5', max: 0 },
]
const OLDER = [
  { key: 'sonnet-5', label: 'Sonnet 5', max: 3 },
  { key: 'opus-5', label: 'Opus 5', max: 4 },
  { key: 'fable-5', label: 'Fable 5', max: 4 },
  { key: 'opus-4-8', label: 'Opus 4.8', max: 4 },
]
type Slot = { col: number; lead: number; width: number; label: string }
/** The same shape the hooks module works out for a pane (see layoutFor in hooks/register.tsx). */
const shapeFor = (bodyColumns: number, bodyRows: number, isMono = false) => {
  const inner = Math.max(0, bodyColumns - 2)
  const labelWidth = isMono ? 11 : 9
  const cell = Math.max(3, Math.min(9, Math.floor((inner - labelWidth - 3) / EFFORTS.length)))
  const boxOf = (name: string) => ((name.length - cell) % 2 === 0 ? name.length : name.length + 1)
  const gutter = Math.max(0, Math.ceil((boxOf(EFFORTS.at(-1) ?? '') - cell) / 2))
  const field = labelWidth + cell * EFFORTS.length + gutter
  const lay = (names: readonly string[], lines: number): Slot[][] | null => {
    const head: Slot[][] = []
    for (let line = 0; line < lines; line++) {
      const slots: Slot[] = []
      let x = 0
      for (let col = line; col < names.length; col += lines) {
        const label = names[col] ?? ''
        const width = boxOf(label)
        const left = labelWidth + cell * col + (cell - width) / 2
        if (left < x || left + width > field) return null
        slots.push({ col, lead: left - x, width, label })
        x = left + width
      }
      head.push(slots)
    }

    return head
  }
  const head = lay(EFFORTS, 1) ?? lay(EFFORTS, 2) ?? lay(EFFORTS, 3) ?? lay(SHORT, 2) ?? lay(SHORT, 3) ?? []
  const pitch = bodyRows >= head.length + 1 + 7 + 2 + 3 ? 2 : 1

  return { models: MAIN, cols: EFFORTS.length, head, at: { row: 0, col: 2 }, isOn: true, page: 0, pages: 3, labelWidth, cell, gutter, pitch, isMono }
}
const BASE = shapeFor(58, 30)

const main = async () => {
  const { default: Grid } = (await import('../hooks/grid.tsx')) as { default: (props: unknown, surface: unknown) => Node }
  /** One instance of the grid, driven as the app drives it: props, its clock, the pointer. */
  const mount = (first: Record<string, unknown>) => {
    let props = { ...BASE, ...first }
    let state: unknown
    let clock: (() => void) | null = null
    let pointer: ((e: Pointer) => void) | null = null
    const surface = {
      elements: { Box: 'Box', Text: 'Text' },
      get state() {
        return state
      },
      setState: (next: unknown) => {
        state = next
      },
      post: () => undefined,
      every: (ms: number, fn: () => void) => {
        if (ms < 1000) clock = fn

        return () => undefined
      },
      onPointer: (fn: (e: Pointer) => void) => {
        pointer = fn

        return () => undefined
      },
      onKey: () => () => undefined,
    }
    const render = () => draw(Grid(props, surface))
    render()

    return {
      render,
      set: (next: Record<string, unknown>) => {
        props = { ...props, ...next }
        render()
      },
      tick: (steps = 1) => {
        for (let i = 0; i < steps; i++) {
          clock?.()
          render()
        }
      },
      point: (e: Pointer) => {
        pointer?.(e)
        render()
      },
    }
  }
  const cellAt = (row: number, col: number, given = BASE) => ({
    x: given.labelWidth + given.cell * col + Math.floor(given.cell / 2),
    y: given.head.length + 1 + row * given.pitch,
  })

  // `--film`: the grid in a hand's control at 60 frames a second, for the
  // launch video. The dot starts on Sonnet 5.5, is dragged to Opus 5.5 at
  // Default, rests, then is dragged to Fable 5.2 at Ultracode. The hand moves
  // the way hands do: curved paths, fast in the middle, a small overshoot and
  // correction at the end, and a tremor that never quite stops.
  if (process.argv.includes('--film')) {
    inks = INKS.dark ?? {}
    const shape = shapeFor(66, 30)
    const top = shape.head.length + 1
    const dotAt = (row: number, col: number) => ({
      x: (shape.labelWidth + shape.cell * col + Math.floor(shape.cell / 2)) * CW + CW / 2,
      y: (top + row * shape.pitch) * RH + RH / 2,
    })
    const FPS = 60
    const N = 540
    const pos: { x: number; y: number }[] = []
    let here = { x: -260, y: 520 }
    const hold = (sec: number) => {
      for (let k = 0; k < Math.round(sec * FPS); k++) pos.push({ ...here })
    }
    /** A reach from here to a point: a slight arc, quick in the middle, past it by a little, then back. */
    const reach = (to: { x: number; y: number }, sec: number, arc: number, over: number) => {
      const from = here
      const dx = to.x - from.x
      const dy = to.y - from.y
      const past = { x: to.x + dx * over, y: to.y + dy * over }
      const n = Math.round(sec * FPS)
      for (let k = 1; k <= n; k++) {
        const u = k / n
        const e = u * u * u * (10 - 15 * u + 6 * u * u)
        const bend = arc * Math.sin(Math.PI * e)
        pos.push({ x: from.x + (past.x - from.x) * e - dy * bend, y: from.y + (past.y - from.y) * e + dx * bend })
      }
      here = past
      const m = Math.round(0.15 * FPS)
      for (let k = 1; k <= m; k++) {
        const u = k / m
        const e = u * u * (3 - 2 * u)
        pos.push({ x: past.x + (to.x - past.x) * e, y: past.y + (to.y - past.y) * e })
      }
      here = to
    }
    const events: { frame: number; kind: 'down' | 'up'; lands?: { row: number; col: number }; says?: string }[] = []
    const mark = (kind: 'down' | 'up', lands?: { row: number; col: number }, says?: string) =>
      events.push({ frame: pos.length, kind, lands, says })
    const sonnet = dotAt(2, 2)
    const opus = dotAt(1, 0)
    const fable = dotAt(0, 6)
    reach({ x: sonnet.x + 2, y: sonnet.y + 1 }, 0.62, 0.1, 0.05)
    hold(0.12)
    mark('down')
    reach({ x: opus.x - 1, y: opus.y + 1 }, 0.58, -0.12, 0.06)
    hold(0.08)
    mark('up', { row: 1, col: 0 }, 'Default keeps the session’s effort level. Set. Your next prompt uses it.')
    reach({ x: opus.x + 14, y: opus.y + 9 }, 0.35, 0.2, 0)
    hold(0.4)
    reach({ x: opus.x + 1, y: opus.y }, 0.3, -0.15, 0.02)
    hold(0.06)
    mark('down')
    reach({ x: fable.x + 1, y: fable.y - 1 }, 0.92, 0.14, 0.035)
    const drop = pos.length / FPS - 0.15
    hold(0.2)
    mark('up', { row: 0, col: 6 }, 'Ultracode sends Max effort and adds the word ultracode to each prompt. Set. Your next prompt uses it.')
    reach({ x: fable.x + 70, y: fable.y + 64 }, 0.8, -0.1, 0)
    while (pos.length < N) hold(0.1)
    // A tremor that never stops: small, slow, and different on each axis.
    const tremor = (i: number) => {
      const t = i / FPS
      return {
        x: 0.7 * Math.sin(t * 7.3) + 0.4 * Math.sin(t * 13.1 + 1.7),
        y: 0.6 * Math.sin(t * 6.1 + 0.9) + 0.35 * Math.sin(t * 11.7 + 2.3),
      }
    }
    const grid = mount({ ...shape, isOn: true, at: { row: 2, col: 2 } })
    const frames: string[] = []
    const track: { x: number; y: number; down: boolean; cell: string }[] = []
    let held = false
    let says = 'Last answer came from Sonnet 5.5.'
    for (let i = 0; i < N; i++) {
      const q = pos[i]!
      const w = tremor(i)
      const p = { x: q.x + w.x, y: q.y + w.y }
      const e = { x: Math.floor(p.x / CW), y: Math.floor(p.y / RH), fine: { x: p.x / CW, y: p.y / RH } }
      for (const ev of events.filter(one => one.frame === i)) {
        if (ev.kind === 'down') {
          grid.point({ type: 'down', ...e, button: 'left' } as Pointer)
          held = true
        } else {
          grid.point({ type: 'up', ...e, button: 'left' } as Pointer)
          held = false
          if (ev.lands) grid.set({ at: ev.lands, isOn: true })
          if (ev.says) says = ev.says
        }
      }
      if (held) grid.point({ type: 'move', ...e, button: 'left' } as Pointer)
      else grid.point({ type: 'move', ...e } as Pointer)
      grid.tick(1)
      frames.push(`<div style="width:560px;height:330px;box-sizing:border-box;background:${inks.page};overflow:hidden;flex-shrink:0">
        ${grid.render()}<div style="color:${inks.inactive};margin-top:${RH}px">${esc(says)}</div></div>`)
      const cell = `${Math.round((p.y / RH - top) / shape.pitch)}:${Math.floor((p.x / CW - shape.labelWidth) / shape.cell)}`
      track.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, down: held, cell: held ? cell : '' })
    }
    const at = (kind: string) => events.filter(one => one.kind === kind).map(one => one.frame / FPS)
    writeFileSync('tools/out/film.json', JSON.stringify({ fps: FPS, track, downs: at('down'), ups: at('up'), drop }))
    for (let page = 0; page * 90 < frames.length; page++) {
      writeFileSync(`tools/out/film${page}.html`, `<!doctype html><meta charset="utf-8">${FACE}<body style="background:${inks.page}">
      <div style="display:flex;flex-wrap:wrap;width:5600px">${frames.slice(page * 90, page * 90 + 90).join('')}</div></body>`)
    }
    console.log(`${frames.length} frames`)

    return
  }

  if (process.argv.includes('--demo')) {
    inks = INKS.dark ?? {}
    const frames: string[] = []
    const grid = mount({ isOn: false })
    let says = 'Following the session. Click a cell or drag the dot to choose a model and effort.'
    const shoot = (steps: number) => {
      for (let i = 0; i < steps; i++) {
        grid.tick(2)
        frames.push(`<div style="width:560px;height:352px;box-sizing:border-box;background:${inks.page};padding:28px 32px;overflow:hidden;flex-shrink:0">
          ${grid.render()}<div style="color:${inks.inactive};margin-top:${RH}px">${esc(says)}</div></div>`)
      }
    }
    /** A drag from one cell to another through the space between, a character or two at a time, as a hand would. */
    const dragTo = (from: [number, number], to: [number, number]) => {
      const a = cellAt(from[0], from[1])
      const b = cellAt(to[0], to[1])
      grid.point({ type: 'down', ...a, button: 'left' })
      const steps = Math.max(8, Math.ceil(Math.hypot(b.x - a.x, (b.y - a.y) * 2.4) / 0.9))
      for (let i = 1; i <= steps; i++) {
        const ease = (1 - Math.cos((Math.PI * i) / steps)) / 2
        grid.point({ type: 'move', x: Math.round(a.x + (b.x - a.x) * ease), y: Math.round(a.y + (b.y - a.y) * ease), button: 'left' })
        shoot(1)
      }
      grid.point({ type: 'up', ...b, button: 'left' })
      grid.set({ at: { row: to[0], col: to[1] }, isOn: true })
    }
    shoot(26)
    dragTo([0, 2], [1, 5])
    says = 'Set. Your next prompt uses it.'
    shoot(34)
    dragTo([1, 5], [0, 6])
    says = 'Ultracode sends Max effort and adds the word ultracode to each prompt.'
    shoot(34)
    dragTo([0, 6], [2, 1])
    says = 'Last answer came from Sonnet 5.5.'
    shoot(40)
    console.log(`<!doctype html><meta charset="utf-8">${FACE}<body style="background:${inks.page}">
    <div data-frames="${frames.length}" style="display:flex;flex-wrap:wrap;width:5600px">${frames.join('')}</div></body>`)

    return
  }

  const shot = (title: string, over: Record<string, unknown>, theme: 'light' | 'dark', act?: (grid: ReturnType<typeof mount>) => void) => {
    inks = INKS[theme] ?? {}
    const grid = mount(over)
    grid.tick(16)
    act?.(grid)

    return `<section style="background:${inks.page};padding:20px 24px 24px;border:1px solid #DEDCD1">
      <div style="font-weight:600;font-size:12px;color:${inks.inactive};margin-bottom:14px">${esc(title)}</div>
      ${grid.render()}
    </section>`
  }
  const at = (row: number, col: number) => ({ at: { row, col } })
  const pages = [
    shot('1. Fable 5.2 at Medium, at rest (light)', {}, 'light'),
    shot('2. The same, a few glimmer steps on', {}, 'light', grid => grid.tick(5)),
    shot('3. Opus 5.5 at Low (dark)', at(1, 1), 'dark'),
    shot('4. Opus 5.5 at High (dark)', at(1, 3), 'dark'),
    shot('5. Opus 5.5 at Max (dark)', at(1, 5), 'dark'),
    shot('6. Fable 5.2 at Ultracode (dark)', at(0, 6), 'dark'),
    shot('7. Mid-drag, between cells, from Fable Medium toward Sonnet High (dark)', {}, 'dark', grid => {
      grid.point({ type: 'down', ...cellAt(0, 2), button: 'left' })
      for (const [x, y] of [[26, 3], [28, 4], [30, 4], [32, 5], [34, 6]] as const) {
        grid.point({ type: 'move', x, y, button: 'left' })
        grid.tick(1)
      }
    }),
    shot('7b. Mid-drag, fast across the row: the ember swells (dark)', {}, 'dark', grid => {
      grid.point({ type: 'down', ...cellAt(0, 0), button: 'left' })
      for (const x of [14, 18, 22, 26, 30, 34]) {
        grid.point({ type: 'move', x, y: 3, button: 'left' })
        grid.tick(1)
      }
    }),
    shot('8. Untouched: follows the session, an ember with no colour (light)', { isOn: false }, 'light'),
    shot('9. Older models, second page (light)', { models: OLDER, page: 1, ...at(1, 4) }, 'light'),
    shot('10. Narrow sidebar, 38 columns: names step down (light)', shapeFor(38, 40), 'light'),
    shot('11. Narrow sidebar, 34 columns (dark)', { ...shapeFor(34, 40), ...at(1, 5) }, 'dark'),
    shot('12. Wide pane, 80 columns: names on one line (dark)', { ...shapeFor(80, 30), ...at(1, 4) }, 'dark'),
    shot('13. Short pane: one line per row (light)', shapeFor(58, 12), 'light'),
    shot('14. Terminal: one cell per character (dark)', shapeFor(60, 30, true), 'dark'),
  ]
  console.log(`<!doctype html><meta charset="utf-8">${FACE}<body style="background:#F5F4ED">
  <div style="display:flex;flex-wrap:wrap;gap:20px;padding:24px;align-items:flex-start">${pages.join('')}</div></body>`)
}

void main()
