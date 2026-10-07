// Colour tokens from the design. Each page has its own accent hue; light/dark recomputes everything.

export type PageKey = 'sale' | 'in' | 'stock' | 'items' | 'sales' | 'alarms'
const H: Record<PageKey, [number, number]> = { sale: [150, 0.15], in: [255, 0.15], stock: [195, 0.11], items: [290, 0.15], sales: [68, 0.13], alarms: [355, 0.16] }
const o = (l: number, c: number, h: number) => `oklch(${l} ${+c.toFixed(3)} ${h})`

export function pal(dark: boolean, k: PageKey): Record<string, string> {
  const [h, c] = H[k], T: Record<string, string> = {}
  for (const kk in H) { const [hh, cc] = H[kk as PageKey]; T['c-' + kk] = dark ? o(0.76, cc, hh) : o(0.5, cc, hh) }
  return Object.assign(T, dark
    ? { bg: o(0.185, 0.008, 260), surface: o(0.225, 0.009, 260), sunk: o(0.2, 0.008, 260), ink: o(0.95, 0.005, 85), muted: o(0.72, 0.012, 260), line: o(0.32, 0.01, 260), acc: o(0.76, c, h), 'acc-ink': o(0.2, 0.03, h), 'acc-soft': o(0.28, c * 0.3, h), 'acc-text': o(0.82, c, h), 'acc-line': o(0.42, c * 0.45, h), neg: o(0.74, 0.16, 27), 'neg-soft': o(0.31, 0.07, 27), warn: o(0.84, 0.13, 80), 'warn-soft': o(0.32, 0.055, 75) }
    : { bg: o(0.975, 0.005, 85), surface: o(0.997, 0.002, 85), sunk: o(0.955, 0.006, 85), ink: o(0.24, 0.012, 60), muted: o(0.5, 0.012, 60), line: o(0.9, 0.007, 85), acc: o(0.5, c, h), 'acc-ink': 'oklch(1 0 0)', 'acc-soft': o(0.955, c * 0.22, h), 'acc-text': o(0.45, c, h), 'acc-line': o(0.86, c * 0.4, h), neg: o(0.53, 0.2, 27), 'neg-soft': o(0.95, 0.035, 27), warn: o(0.55, 0.15, 50), 'warn-soft': o(0.95, 0.05, 70) })
}

/** Category colour: cc = strong mark, cs = soft header background. hue null = grey. */
export function catColor(hue: number | null | undefined, dark: boolean) {
  if (hue == null) return { cc: dark ? 'oklch(0.7 0.01 260)' : 'oklch(0.6 0.01 260)', cs: dark ? 'oklch(0.3 0.01 260)' : 'oklch(0.94 0.005 260)' }
  return { cc: dark ? `oklch(0.74 0.13 ${hue})` : `oklch(0.58 0.15 ${hue})`, cs: dark ? `oklch(0.32 0.06 ${hue})` : `oklch(0.94 0.04 ${hue})` }
}

/** Text colour on a strong accent button (sale/in buttons). */
export const btnInk = (dark: boolean) => (dark ? 'oklch(0.2 0.03 255)' : '#fff')
