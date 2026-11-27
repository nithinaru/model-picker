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
  const efforts = ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max', 'Ultracode']
    .map((label, index) => ({ key: label.toLowerCase().replace('extra high', 'xhigh'), label, index }))
    .reverse()
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
  const THEME: Record<string, Record<string, string>> = {
    '#FFFFFF': { text: '#141413', inactive: '#73726C', subtle: '#D1CFC5', claude: '#C6613F' },
    '#262624': { text: '#FAF9F5', inactive: '#9C9A92', subtle: '#4A4945', claude: '#D97757' },
  }
  const shot = (title: string, over: Record<string, unknown>, state?: unknown, page = '#FFFFFF') => {
    const props = { efforts, models: MAIN, at: { row: 4, col: 0 }, isOn: true, page: 0, pages: 3, labelWidth: 11, cell: 11, isMono: false, ...over }
    const surface = {
      elements: { Box: 'Box', Text: 'Text' },
      state,
      setState: () => undefined,
      post: () => undefined,
      every: () => () => undefined,
      onPointer: () => () => undefined,
      onKey: () => () => undefined,
    }
    const ink = THEME[page] ?? {}
    const html = draw(Grid(props, surface)).replace(/color:(text|inactive|subtle|claude)/g, (_, key: string) => `color:${ink[key]}`)
    const face = props.isMono ? `font-family:'SF Mono',Menlo,monospace;font-size:12.5px` : ''

    return `<section style="background:${page};padding:20px 22px 22px;border:1px solid #DEDCD1">
      <div style="font:600 12px -apple-system;color:${ink.inactive};margin-bottom:14px">${esc(title)}</div>
      <div style="display:inline-block;${face}">${html}</div>
    </section>`
  }
  const tick = (n: number) => ({ hover: null, foot: null, tick: n })
  const pages = [
    shot('1. Picked: Fable 5.2 at Medium, at rest (light)', {}, tick(1)),
    shot('2. Same, the next glimmer step', {}, tick(2)),
    shot('3. Picked: Opus 5.5 at Ultracode (dark)', { at: { row: 0, col: 1 } }, tick(1), '#262624'),
    shot('4. Picked: Sonnet 5.5 at High, hovering Opus 5.5 at Max (dark)', { at: { row: 3, col: 2 } }, { hover: { row: 1, col: 1 }, foot: null, tick: 3 }, '#262624'),
    shot('5. Untouched: follows the session, no ember', { isOn: false, at: { row: 4, col: 0 } }, tick(1)),
    shot('6. Older models, second page', { models: OLDER, page: 1, at: { row: 2, col: 1 } }, tick(1)),
    shot('7. Narrow pane (cell 7)', { cell: 7 }, tick(1)),
    shot('8. Terminal (one cell per character)', { isMono: true }, tick(1), '#262624'),
  ]
  console.log(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#F5F4ED;font:13px/${RH}px -apple-system,'SF Pro Text',sans-serif">
  <div style="display:flex;flex-wrap:wrap;gap:20px;padding:24px;align-items:flex-start">${pages.join('')}</div></body>`)
}

void main()
