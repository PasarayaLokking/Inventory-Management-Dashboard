import { useState } from 'react'
import { useData } from '../lib/data.tsx'
import { supabase } from '../lib/supabase.ts'
import { PRESETS, SYS, alarmTh, norm, rg, type Item, type Sys } from '../lib/stats.ts'
import { useUi, AlarmRow } from '../ui.tsx'

/** Add or edit an item (admin). */
export function EditItem({ item, catId }: { item: Item | null; catId?: string }) {
  const d = useData(), ui = useUi()
  const fallbackCat = catId ?? d.cats.find(c => c.name === 'Uncategorised')?.id ?? d.cats[0]?.id ?? ''
  const [f, setF] = useState(() => ({
    tag: item?.tag ?? '', category_id: item?.category_id ?? fallbackCat, colour: item?.colour ?? '', brand: item?.brand ?? '', details: item?.details ?? '', note: item?.note ?? '',
    size_system: item?.size_system ?? ('UK' as Sys), size_from: item?.size_from ?? 4, size_to: item?.size_to ?? 12,
  }))
  const th0 = item ? alarmTh(item, d.cats) : null
  const [al, setAl] = useState({ on: th0 !== null, th: th0 ?? 2, touched: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<typeof f>) => { setF(x => ({ ...x, ...p })); setErr('') }
  const field = (k: 'tag' | 'colour' | 'brand' | 'details', label: string, ph: string, extra = {}) => (
    <label className="lbl">{label}<input className="inp" value={f[k]} onChange={e => set({ [k]: e.target.value })} placeholder={ph} style={extra} /></label>
  )

  async function save() {
    const tag = f.tag.trim()
    if (!tag) return setErr('Give the item a name or model number, for example "Line 7 2146".')
    if (f.size_from > f.size_to) return setErr('The first size must be smaller than the last size.')
    if (d.live.some(i => i.id !== item?.id && norm(i.tag) === norm(tag))) return setErr('There is already an item called "' + tag + '". Use a different name.')
    if (item) {
      // pairs in a size you drop would silently vanish from the totals
      const stranded = rg(item.size_from, item.size_to).filter(z => (z < f.size_from || z > f.size_to) && d.st(item.id, z) !== 0)
      if (stranded.length) return setErr('Size ' + stranded.join(', ') + ' still has stock. Record a stock count of 0 for ' + (stranded.length > 1 ? 'those sizes' : 'that size') + ' first, or keep it in the range.')
    }
    const alarm: Partial<Pick<Item, 'alarm_on' | 'alarm_th'>> = item ? (al.touched ? { alarm_on: al.on, alarm_th: al.th } : {}) : { alarm_on: al.on ? true : null, alarm_th: al.on ? al.th : null }
    const row = { ...f, tag, ...alarm }
    setBusy(true)
    const q = item ? supabase.from('items').update(row).eq('id', item.id) : supabase.from('items').insert(row)
    const { error } = await q
    setBusy(false)
    if (error) return setErr(error.code === '23505' ? 'There is already an item called "' + tag + '". Use a different name.' : error.message)
    await d.reload()
    if (item) { ui.openItem(item.id); ui.toast('Item saved · ' + tag) }
    else { ui.closeDrawer(); ui.toast('Item added · ' + tag + ' · low-stock alarm ' + (al.on ? 'on' : 'off')) }
  }

  const sizeOpts = SYS[f.size_system].sizes
  const sel = { height: 40, padding: '0 10px', borderRadius: 8 }
  return (
    <>
      <div style={{ position: 'relative', padding: '22px 24px 18px', background: 'var(--acc-soft)', borderBottom: '1px solid var(--acc-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="topbar" />
        <div><div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{item ? 'Edit item' : 'New item'}</div><h2 style={{ margin: '4px 0 0', fontSize: 24, letterSpacing: '-.02em' }}>{item ? f.tag || 'Untitled' : 'Add an item'}</h2></div>
        <button onClick={ui.closeDrawer} aria-label="Close" className="x">×</button>
      </div>
      <div className="col" style={{ flex: 1, overflow: 'auto', padding: '22px 24px', gap: 16 }}>
        {err && <div role="alert" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 13, fontWeight: 600 }}>{err}</div>}
        {field('tag', 'Name / model', 'e.g. Line 7 2146', { fontSize: 15 })}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
          <label className="lbl">Category
            <select className="inp" value={f.category_id} onChange={e => set({ category_id: e.target.value })} style={{ padding: '0 10px' }}>
              {d.cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {field('colour', 'Colour', 'Black')}
          {field('brand', 'Brand', 'Line 7')}
        </div>
        {field('details', 'Details', 'Court shoes, RM89.90, supplier JLG')}
        <div className="col" style={{ gap: 8 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Sizes</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map(([label, sys, a, b]) => {
              const on = f.size_system === sys && f.size_from === a && f.size_to === b
              return <button key={label} onClick={() => set({ size_system: sys, size_from: a, size_to: b })} aria-pressed={on} style={{ whiteSpace: 'nowrap', height: 34, padding: '0 12px', border: '1px solid ' + (on ? 'var(--acc)' : 'var(--line)'), borderRadius: 999, background: on ? 'var(--acc)' : 'transparent', color: on ? 'var(--acc-ink)' : 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{label}</button>
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="inp" value={f.size_system} onChange={e => { const k = e.target.value as Sys, z = SYS[k].sizes; set({ size_system: k, size_from: z[0], size_to: z[z.length - 1] }) }} aria-label="Size system" style={sel}>
              <option value="UK">UK</option><option value="EU">EU</option><option value="CAP">Capal</option>
            </select>
            <select className="inp" value={f.size_from} onChange={e => set({ size_from: +e.target.value })} aria-label="From size" style={sel}>{sizeOpts.map(z => <option key={z} value={z}>{z}</option>)}</select>
            <span className="muted">to</span>
            <select className="inp" value={f.size_to} onChange={e => set({ size_to: +e.target.value })} aria-label="To size" style={sel}>{sizeOpts.map(z => <option key={z} value={z}>{z}</option>)}</select>
          </div>
        </div>
        <AlarmRow on={al.on} th={al.th}
          src={item ? (al.on ? 'Pop-up when any size drops to the level you pick.' : 'Off. No pop-ups for this shoe.') : 'Off by default for new shoes. Turn on to get a pop-up when a size runs low.'}
          onToggle={() => setAl({ ...al, on: !al.on, touched: true })} onTh={th => setAl({ on: true, th, touched: true })} />
        <label className="lbl">Note for staff
          <textarea className="inp" value={f.note} onChange={e => set({ note: e.target.value })} rows={3} placeholder="e.g. Size 12 is on the top shelf in the store room" style={{ height: 'auto', padding: '10px 12px', resize: 'vertical' }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '16px 24px', borderTop: '1px solid var(--line)' }}>
        {item && <button onClick={() => ui.setModal({ kind: 'removeItem', id: item.id })} className="btn hov-neg" style={{ height: 44, border: 0, color: 'var(--neg)' }}>Remove item</button>}
        <button onClick={() => (item ? ui.openItem(item.id) : ui.closeDrawer())} className="btn" style={{ marginLeft: 'auto', height: 44, padding: '0 16px' }}>Cancel</button>
        <button onClick={save} disabled={busy} className="btn btn-acc" style={{ height: 44, padding: '0 20px' }}>{busy ? 'Saving…' : item ? 'Save item' : 'Add item'}</button>
      </div>
    </>
  )
}
