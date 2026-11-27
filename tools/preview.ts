// Draws the grid to an HTML page without the app, so its look can be checked
// by eye: `npx tsx tools/preview.ts > preview.html`. Cells are approximated at
// the desktop app's size; the app remains the final word.
type Node = { type: string; props: Record<string, unknown>; children: unknown[] } | string | null | false

;(globalThis as Record<string, unknown>).h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) =>
  typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat(9) }

const CW = 8.4
const RH = 21
// The theme keys the grid draws with, as the app's light and dark themes ink them.
const INKS: Record<string, Record<string, string>> = {
  light: { text: '#141413', inactive: '#73726C', subtle: '#C2C0B6', claude: '#D97757' },
  dark: { text: '#FAF9F5', inactive: '#9C9A92', subtle: '#5C5B57', claude: '#D97757' },
}
let inks = INKS.light ?? {}
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const size = (value: unknown, unit: number) => (typeof value === 'number' ? `${value * unit}px` : undefined)

const draw = (node: Node): string => {
  if (Array.isArray(node)) return node.map(child => draw(child as Node)).join('')
  if (node === null || node === false || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(String(node))
  const p = node.props
  const inner = node.children.map(child => draw(child as Node)).join('')
  if (node.type === 'Text') {
    const color = typeof p.color === 'string' ? (inks[p.color] ?? p.color) : 'inherit'
    // A Text wraps unless it says otherwise, as in the app; one that is cut is
    // cut at its box. Either fault is outlined in red by the script on the page.
    const isCut = p.wrap !== undefined && p.wrap !== 'wrap'
    const css = [
      `color:${color}`,
      p.bold ? 'font-weight:600' : '',
      p.italic ? 'font-style:italic' : '',
      p.underline ? 'text-decoration:underline;text-underline-offset:3px' : '',
      isCut ? 'white-space:nowrap;overflow:hidden;min-width:0' : 'min-width:0',
      p.wrap === 'truncate-end' ? 'text-overflow:ellipsis' : '',
    ].join(';')

    return `<span data-text style="${css}">${inner}</span>`
  }
  const px = (p.paddingX as number | undefined) ?? 0
  const py = (p.paddingY as number | undefined) ?? 0
  const css = [
    'display:flex',
    'box-sizing:border-box',
    'flex-shrink:0',
    `flex-direction:${p.flexDirection ?? 'row'}`,
    p.justifyContent ? `justify-content:${p.justifyContent}` : '',
    p.backgroundColor ? `background:${p.backgroundColor}` : '',
    p.width !== undefined ? `width:${size(p.width, CW)}` : '',
    p.height !== undefined ? `height:${size(p.height, RH)}` : `min-height:${p.flexDirection === 'column' ? 0 : RH}px`,
    `padding:${py * RH}px ${px * CW}px`,
    p.paddingLeft ? `padding-left:${(p.paddingLeft as number) * CW}px` : '',
    p.gap ? `gap:${(p.gap as number) * CW}px` : '',
    'align-items:' + (p.flexDirection === 'column' ? 'stretch' : 'center'),
  ].join(';')

  return `<div style="${css}">${inner}</div>`
}

const main = async () => {
  const { default: Grid } = (await import('../hooks/grid.tsx')) as { default: (props: unknown, surface: unknown) => Node }
  const MAIN = [
    { key: 'opus-5-5', label: 'Opus 5.5', max: 6, isOlder: false },
    { key: 'fable-5-2', label: 'Fable 5.2', max: 6, isOlder: false },
    { key: 'sonnet-5-5', label: 'Sonnet 5.5', max: 3, isOlder: false },
    { key: 'haiku-5-5', label: 'Haiku 5.5', max: 0, isOlder: false },
  ]
  const OLDER = [
    { key: 'sonnet-5', label: 'Sonnet 5', max: 3, isOlder: true },
    { key: 'opus-5', label: 'Opus 5', max: 4, isOlder: true },
    { key: 'fable-5', label: 'Fable 5', max: 4, isOlder: true },
    { key: 'opus-4-8', label: 'Opus 4.8', max: 4, isOlder: true },
    { key: 'opus-4-7', label: 'Opus 4.7', max: 4, isOlder: true },
    { key: 'opus-4-6', label: 'Opus 4.6', max: 3, isOlder: true },
    { key: 'sonnet-4-6', label: 'Sonnet 4.6', max: 3, isOlder: true },
  ]
  const cols = ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultracode']
  const shortCols = ['Def', 'Low', 'Med', 'High', 'Extra', 'Max', 'Ultra']
  const SET = 'Set. Your next prompt uses it.'
  const RAN = 'Last answer came from Fable 5.2.'
  const hints = ["Keeps the session's effort level.", '', '', '', '', '', 'Max effort plus the ultracode keyword.']
  type Shot = { state?: unknown; page?: string; caption?: string; mono?: boolean }
  const shot = (title: string, over: Record<string, unknown>, { state, page = '#FFFFFF', caption = RAN, mono = false }: Shot = {}) => {
    inks = (page === '#FFFFFF' ? INKS.light : INKS.dark) ?? {}
    const props = {
      rows: MAIN, cols, shortCols, hints, at: { row: 1, col: 2 }, isOn: true, isExpanded: false,
      moreCount: OLDER.length, labelWidth: 12, cell: 5, gutter: 3, isMono: mono, ...over,
    }
    const surface = {
      elements: { Box: 'Box', Text: 'Text' },
      state,
      setState: () => undefined,
      post: () => undefined,
      every: () => () => undefined,
      onPointer: () => () => undefined,
      onKey: () => () => undefined,
    }
    const ink = page === '#FFFFFF' ? '#73726C' : '#9C9A92'
    const face = mono ? `font-family:Menlo,monospace;font-size:${CW / 0.602}px` : ''

    return `<section style="background:${page};padding:20px 22px 22px;border:1px solid #DEDCD1">
      <div style="font:600 12px -apple-system;color:${ink};margin-bottom:12px">${esc(title)}</div>
      <div style="display:inline-block;${face}">${draw(Grid(props, surface))}</div>
      <div style="font:13px -apple-system;color:${ink};margin-top:14px;max-width:${(props.labelWidth + props.cell * 7 + props.gutter) * CW}px">${esc(caption)}</div>
    </section>`
  }
  const idle = { hover: null, foot: null, focus: null, tick: 1 }
  const pages = [
    shot('1. Picked: Fable 5.2 at Medium (light app theme, cell 6: the pane above the prompt)', { cell: 6 }),
    shot('2. Hovering Opus 5.5 at Ultracode: its hint', { cell: 6 }, { state: { ...idle, hover: { row: 0, col: 6 } } }),
    shot('3. Picked: Opus 5.5 at Ultracode (dark app theme)', { cell: 6, at: { row: 0, col: 6 } }, {
      page: '#262624',
      caption: `Ultracode sends Max effort and adds the word ultracode to each prompt. ${SET}`,
    }),
    shot('4. Untouched: follows the session', { cell: 6, isOn: false, at: { row: 2, col: 3 } }, {
      caption: 'Following the session. Click a cell or drag the dot to choose a model and effort.',
    }),
    shot('5. More models unfolded, hovering Fewer models', { cell: 6, rows: [...MAIN, ...OLDER], isExpanded: true, moreCount: 0 }, {
      state: { ...idle, foot: 'more' },
    }),
    shot('6. Narrow pane (cell 3)', { cell: 3 }),
    shot('7. Names on one line (cell 8), arrow keys on Use session model', { cell: 8 }, { state: { ...idle, focus: 'reset' } }),
    shot('8. Wide pane (cell 11), dark app theme', { cell: 11 }, { page: '#262624' }),
    shot('9. Terminal, one cell per character (cell 5)', { cell: 5 }, { mono: true, page: '#262624' }),
    shot('10. Terminal, light theme (cell 6)', { cell: 6, at: { row: 0, col: 4 } }, { mono: true }),
    shot('11. Session model with no row: no dot', { cell: 6, isOn: false, at: { row: -1, col: -1 } }, {
      caption: 'Following the session on claude-opus-6, which has no row here. Click a cell or drag the dot to choose a model and effort.',
    }),
    shot('12. Two-line names at their tightest (cell 5)', { cell: 5, at: { row: 0, col: 4 } }),
  ]
  console.log(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#F5F4ED;font:13px/${RH}px -apple-system,'SF Pro Text',sans-serif">
  <div style="display:flex;flex-wrap:wrap;gap:20px;padding:24px;align-items:flex-start">${pages.join('')}</div>
  <script>for (const t of document.querySelectorAll('[data-text]')) {
    const box = t.parentElement
    if (t.scrollWidth > t.clientWidth + 1 || t.getBoundingClientRect().height > ${RH} + 1 || t.getBoundingClientRect().width > box.getBoundingClientRect().width + 0.5) t.style.outline = '1px solid red'
  }</script></body>`)
}

void main()
