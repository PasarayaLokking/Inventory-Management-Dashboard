import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { LBL, type AlarmHit, type Item, type Line, type MoveType } from './lib/stats.ts'

export type Page = 'sale' | 'stock' | 'sales'
export type EntryLine = { id: number; q: string; it: string | null; size: string; pairs: string }
export type Drawer = { kind: 'item'; id: string } | { kind: 'edit'; item: Item | null; catId?: string } | { kind: 'alarms' }
export type Modal = { kind: 'removeItem'; id: string } | { kind: 'delCat'; id: string; to: string }
export type ToastKind = 'ok' | 'err' | 'warn' | 'info'
/** The New sale / Stock in form: a sale, or stock in as Supply ('in') or Return ('ret'). */
export type EntryMode = 'sale' | 'in' | 'ret'

let lid = 1
export const newLine = (p: Partial<EntryLine> = {}): EntryLine => ({ id: lid++, q: '', it: null, size: '', pairs: '', ...p })

export type Ui = {
  dark: boolean; narrow: boolean
  page: Page; go: (p: Page) => void
  mode: EntryMode; setMode: (m: EntryMode) => void
  lines: EntryLine[]; setLines: Dispatch<SetStateAction<EntryLine[]>>
  drawer: Drawer | null; openItem: (id: string) => void; openEdit: (it: Item | null, catId?: string) => void; openAlarms: () => void; closeDrawer: () => void
  setModal: (m: Modal | null) => void
  toast: (msg: string, kind?: ToastKind, undo?: () => void) => void
  /** Saves a stock change through the database function. Returns false when it failed (the form keeps its lines). */
  record: (type: MoveType, date: string, note: string, lines: Line[], msg: string, alarmLines?: Line[]) => Promise<boolean>
  undo: (movementId: string, label: string) => Promise<void>
  /** Runs an admin table write, reloads, toasts. Returns false on error. */
  write: (q: PromiseLike<{ error: unknown }>, okMsg?: string, undo?: () => void) => Promise<boolean>
  showAlarm: (hits: AlarmHit[], title?: string, body?: string) => void
  addToIn: (list: { item_id: string; size: number }[]) => void
  restockLine: (it: Item) => void
  /** Opens the New sale / Stock in page with this shoe on a new line, ready for its size. */
  startEntry: (it: Item, m: EntryMode) => void
  setItemAlarm: (id: string, on: boolean | null, th: number, quiet?: boolean, why?: string) => Promise<void>
  setCatAlarm: (id: string, on: boolean, th: number, quiet?: boolean) => Promise<void>
  togglePin: (id: string) => Promise<void>
}

export const UiContext = createContext<Ui>(null!)
export const useUi = () => useContext(UiContext)

export const focusId = (id: string, select = false) => setTimeout(() => { const e = document.getElementById(id) as HTMLInputElement | null; e?.focus(); if (select) e?.select?.() }, 40)

export function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
}

/** Supply / Return badge: a circle in the kind's colour with a truck (Supply) or a U-turn arrow (Return). */
export function MoveIcon({ type, size = 18 }: { type: 'in' | 'ret'; size?: number }) {
  const fill = 'var(--c-' + type + ')'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={LBL[type]} style={{ flex: '0 0 auto', verticalAlign: 'middle' }}>
      <title>{LBL[type]}</title>
      <circle cx={12} cy={12} r={12} style={{ fill }} />
      <g style={{ fill: 'none', stroke: 'var(--surface)', strokeWidth: type === 'in' ? 1.6 : 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
        {type === 'in'
          ? <><path d="M5 8h8v6.5H5zM13 10h3.5l2.5 2.5v2H13" /><circle cx={8} cy={15.5} r={1.6} style={{ fill }} /><circle cx={16} cy={15.5} r={1.6} style={{ fill }} /></>
          : <path d="M9 7h5a3.5 3.5 0 0 1 0 7H7m3-3-3 3 3 3" />}
      </g>
    </svg>
  )
}

export function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} aria-label={label} className="switch" style={{ background: on ? 'var(--neg)' : 'var(--line)' }}>
      <span style={{ left: on ? 21 : 3 }} />
    </button>
  )
}

export function PageHeader({ eyebrow, title, sub, right, below }: { eyebrow: string; title: string; sub: string; right?: ReactNode; below?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="topbar" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div className="col" style={{ gap: 4 }}>
          <div style={{ fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 600, opacity: 0.75 }}>{eyebrow}</div>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.1, letterSpacing: '-.02em', fontWeight: 700 }}>{title}</h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.8, textWrap: 'pretty' }}>{sub}</p>
        </div>
        {right}
      </div>
      {below}
    </header>
  )
}

/** The low-stock alarm row used in the item card and the edit drawer. */
export function AlarmRow({ on, th, src, onToggle, onTh, tinted }: { on: boolean; th: number; src: string; onToggle: () => void; onTh: (v: number) => void; tinted?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 14px', border: '1px solid ' + (tinted && on ? 'var(--neg)' : 'var(--line)'), borderRadius: 12, background: tinted && on ? 'var(--neg-soft)' : 'var(--surface)', transition: 'background 200ms' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Low-stock alarm</div>
        <div className="muted" style={{ fontSize: 12, textWrap: 'pretty' }}>{src}</div>
      </div>
      <ThSelect value={th} off={!on} onChange={onTh} />
      <Switch on={on} onClick={onToggle} label="Low-stock alarm" />
    </div>
  )
}

export function ThSelect({ value, off, onChange }: { value: number; off: boolean; onChange: (v: number) => void }) {
  const opts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20]
  if (!opts.includes(value)) opts.push(value)
  return (
    <select value={String(value)} onChange={e => onChange(+e.target.value)} disabled={off} aria-label="Alarm level" className="inp" style={{ height: 36, padding: '0 8px', borderRadius: 8, opacity: off ? 0.5 : 1 }}>
      {opts.sort((a, b) => a - b).map(n => <option key={n} value={n}>{n === 0 ? 'At 0 (sold out)' : 'At ' + n + ' or less'}</option>)}
    </select>
  )
}
