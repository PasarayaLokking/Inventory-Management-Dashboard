// Stock and sales maths, ported from the design prototype (design/Shoe Stock Control.dc.html).
// Pure functions only, so they can be tested with plain `node --test`.

export type Sys = 'UK' | 'EU' | 'CAP'
export type Role = 'admin' | 'staff'
export type MoveType = 'sold' | 'in' | 'ret' | 'count' | 'ex' | 'open'

export type Profile = { id: string; username: string; display_name: string; role: Role }
export type Category = { id: string; name: string; hue: number | null; sort_order: number; alarm_on: boolean; alarm_th: number }
export type Item = {
  id: string; code: string; tag: string; colour: string; brand: string; details: string; note: string
  category_id: string; size_system: Sys; size_from: number; size_to: number
  alarm_on: boolean | null; alarm_th: number | null; alarm_why: string; removed_at: string | null
}
export type Line = { item_id: string; size: number; qty: number }
export type Movement = { id: string; type: MoveType; occurred_on: string; note: string; created_by: string | null; created_at: string; movement_lines: Line[] }
export type SoldDay = { item_id: string; size: number; day: string; pairs: number }
export type SoldMonth = { item_id: string; month: string; pairs: number; last_day: string }
/** Stock in per day: 'in' = Supply, 'ret' = Return (in_daily view). */
export type InDay = { item_id: string; size: number; type: 'in' | 'ret'; day: string; pairs: number }
export type StockFn = (itemId: string, size: number) => number

export const DAY = 864e5
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const rg = (a: number, b: number) => { const r: number[] = []; for (let i = a; i <= b; i++) r.push(i); return r }
export const SYS: Record<Sys, { label: string; short: string; sizes: number[] }> = {
  UK: { label: 'UK sizes', short: 'UK', sizes: rg(4, 12) },
  EU: { label: 'EU sizes', short: 'EU', sizes: rg(33, 48) },
  CAP: { label: 'Capal sizes', short: 'Capal', sizes: rg(1, 13) },
}
export const PRESETS: [string, Sys, number, number][] = [['UK 4–10', 'UK', 4, 10], ['UK 4–12', 'UK', 4, 12], ['EU 39–45', 'EU', 39, 45], ['EU 33–45', 'EU', 33, 45], ['Capal 1–10', 'CAP', 1, 10]]
export const HUES = [250, 45, 300, 150, 200, 15, 95, 330]
export const LBL: Record<MoveType, string> = { sold: 'Sold', in: 'Supply', ret: 'Return', count: 'Stock count', ex: 'Size exchange', open: 'Opening stock' }

export const norm = (s: unknown) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
export const n0 = (n: number) => Number(n).toLocaleString('en-MY')
export const f1 = (n: number) => (Math.round(n * 10) / 10).toString()
export const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's')

// Dates are shop-local calendar days ("YYYY-MM-DD"), never UTC.
const pad = (n: number) => String(n).padStart(2, '0')
export const isoDay = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const parse = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }
export const agoDay = (days: number, today: Date) => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days))
export const daysAgo = (iso: string, today: Date) => Math.round((parse(isoDay(today)).getTime() - parse(iso).getTime()) / DAY)
export const fmtDay = (iso: string, today: Date, year = false) => {
  if (daysAgo(iso, today) === 0) return 'Today'
  const x = parse(iso); return x.getDate() + ' ' + MON[x.getMonth()] + (year ? ' ' + x.getFullYear() : '')
}
/** Month label k = 0..11, where 11 is the current month. */
export const monthName = (k: number, today: Date) => MON[(today.getMonth() - 11 + k + 24) % 12]
const monthIdx = (iso: string, today: Date) => { const x = parse(iso); return 11 - ((today.getFullYear() - x.getFullYear()) * 12 + today.getMonth() - x.getMonth()) }

export type ItemStat = {
  s7: number; s30: number; s90: number; s365: number; last: number | null
  mon: number[]; weekly: number[]; sz30: Record<number, number>; sz90: Record<number, number>
  sizes: number[]; total: number; wk: number; cover: number | null; coverTxt: string
}

/** Per-item sales and cover figures. s365 = the 12 monthly bars (this month so far + 11 before). */
export function buildStats(items: Item[], st: StockFn, daily: SoldDay[], monthly: SoldMonth[], today: Date) {
  const S: Record<string, ItemStat> = {}
  for (const it of items) S[it.id] = { s7: 0, s30: 0, s90: 0, s365: 0, last: null, mon: Array(12).fill(0), weekly: Array(8).fill(0), sz30: {}, sz90: {}, sizes: [], total: 0, wk: 0, cover: null, coverTxt: '' }
  for (const r of daily) {
    const a = S[r.item_id], d = daysAgo(r.day, today)
    if (!a || d < 0 || d >= 90) continue
    a.s90 += r.pairs; a.sz90[r.size] = (a.sz90[r.size] || 0) + r.pairs
    if (d < 30) { a.s30 += r.pairs; a.sz30[r.size] = (a.sz30[r.size] || 0) + r.pairs }
    if (d < 7) a.s7 += r.pairs
    if (d < 56) a.weekly[7 - Math.floor(d / 7)] += r.pairs
  }
  for (const r of monthly) {
    const a = S[r.item_id], mi = monthIdx(r.month, today)
    if (!a || mi < 0 || mi > 11) continue
    a.mon[mi] += r.pairs; a.s365 += r.pairs
    const d = daysAgo(r.last_day, today)
    if (d >= 0 && (a.last === null || d < a.last)) a.last = d
  }
  for (const it of items) {
    const a = S[it.id]
    a.sizes = rg(it.size_from, it.size_to)
    a.total = a.sizes.reduce((t, z) => t + st(it.id, z), 0)
    a.wk = a.s90 / 13
    a.cover = a.wk > 0 ? Math.max(0, a.total) / a.wk : null
    a.coverTxt = a.total <= 0 ? 'Out' : a.cover === null ? 'No sales' : a.cover >= 52 ? '52+ wk' : a.cover < 1 ? '<1 wk' : Math.round(a.cover) + ' wk'
  }
  return S
}

/** Pairs of one stock-in kind over the last `days` days (today counts as day 0), per item or per any key. */
export function inSum(rows: InDay[], type: InDay['type'], days: number, today: Date, key = (r: InDay) => r.item_id) {
  const out: Record<string, number> = {}
  for (const r of rows) { const d = daysAgo(r.day, today); if (r.type === type && d >= 0 && d < days) { const k = key(r); out[k] = (out[k] || 0) + r.pairs } }
  return out
}

/** Every word must appear somewhere in tag/code/colour/details/brand/category; tag-prefix matches first. */
export function search<T extends Item>(q: string, items: T[], catName: (id: string) => string) {
  const words = q.toLowerCase().split(/\s+/).map(norm).filter(Boolean)
  if (!words.length) return items.slice()
  const nq = norm(q)
  return items
    .filter(it => { const h = norm([it.tag, it.code, it.colour, it.details, it.brand, catName(it.category_id)].join(' ')); return words.every(x => h.includes(x)) || h.includes(nq) })
    .sort((a, b) => (norm(b.tag).startsWith(nq) ? 1 : 0) - (norm(a.tag).startsWith(nq) ? 1 : 0))
}

/** The pairs level that rings this item's alarm, or null when no alarm applies. A shoe's own setting beats its category's. */
export function alarmTh(it: Item | undefined, cats: Category[]): number | null {
  if (!it) return null
  if (it.alarm_on !== null) return it.alarm_on ? it.alarm_th ?? 2 : null
  const c = cats.find(x => x.id === it.category_id)
  return c && c.alarm_on ? c.alarm_th : null
}

export type AlarmHit = { item_id: string; tag: string; size: number; v: number; th: number }

/** Sizes that a pending change (signed lines) would take to or below their alarm level. */
export function alarmCheck(lines: Line[], items: Item[], cats: Category[], st: StockFn): AlarmHit[] {
  const net: Record<string, number> = {}, out: AlarmHit[] = [], seen = new Set<string>()
  for (const l of lines) { const k = l.item_id + '|' + l.size; net[k] = (net[k] || 0) + l.qty }
  for (const l of lines) {
    const k = l.item_id + '|' + l.size
    if (seen.has(k) || net[k] >= 0) continue
    seen.add(k)
    const it = items.find(i => i.id === l.item_id), th = alarmTh(it, cats)
    if (!it || th === null) continue
    const v = st(l.item_id, l.size) + net[k]
    if (v <= th) out.push({ item_id: it.id, tag: it.tag, size: l.size, v, th })
  }
  return out
}

/** % change of the last 3 full months against the 3 before; null when there is nothing to compare. */
export const trendOf = (mo: number[]) => { const l3 = mo[8] + mo[9] + mo[10], p3 = mo[5] + mo[6] + mo[7]; return p3 ? Math.round((l3 - p3) / p3 * 100) : l3 ? 100 : null }
export const coverWords = (X: ItemStat) => X.cover === null ? '' : X.cover < 1 ? 'less than a week' : X.cover >= 52 ? 'over a year' : 'about ' + Math.round(X.cover) + ' weeks'

/** RFC 4180 CSV text. */
export const toCsv = (rows: unknown[][]) => rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }).join(',')).join('\n')
