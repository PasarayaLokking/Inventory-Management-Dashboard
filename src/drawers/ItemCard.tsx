import { useEffect, useState } from 'react'
import { useData } from '../lib/data.tsx'
import { supabase } from '../lib/supabase.ts'
import { catColor, btnInk } from '../lib/theme.ts'
import { LBL, agoDay, alarmTh, f1, fmtDay, isoDay, monthName, plural, rg, type Line, type Movement } from '../lib/stats.ts'
import { useUi, AlarmRow } from '../ui.tsx'

type Act = 'sale' | 'in' | 'ret' | 'count' | 'ex'
const AT: Record<Act, [title: string, help: string, inLabel: string, save: string, notePh: string]> = {
  sale: ['Record a sale', 'Type pairs sold under each size.', 'Sold now', 'Save sale', 'Receipt no. (optional)'],
  in: ['Record stock in', 'Type pairs received under each size.', 'Received', 'Save stock in', 'Supplier / invoice no.'],
  ret: ['Customer return', 'Type pairs brought back. They go back into stock.', 'Returned', 'Save return', 'Reason (optional)'],
  count: ['Stock count', 'Type what you counted on the shelf. The app records the difference.', 'Counted', 'Save count', 'Who counted (optional)'],
  ex: ['Size exchange', 'Customer swapped one pair for another size.', '', 'Save exchange', 'Receipt no. (optional)'],
}
const TYPE = { sale: 'sold', in: 'in', ret: 'ret', count: 'count', ex: 'ex' } as const

/** The item card drawer (admin): sizes, insight, alarm, quick actions, monthly bars, history. */
export function ItemCard({ id }: { id: string }) {
  const d = useData(), ui = useUi(), { S, st, today } = d
  const it = d.byId(id)
  const [act, setAct] = useState<Act | null>(null)
  const [inp, setInp] = useState<Record<number, string>>({})
  const [ex, setEx] = useState({ from: '', to: '' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [hist, setHist] = useState<{ rows: Movement[]; count: number } | null>(null)

  // history reloads whenever the shared data does (d.recent is replaced on every reload)
  useEffect(() => {
    let live = true
    supabase.from('movements').select('id,type,occurred_on,note,created_by,created_at,movement_lines!inner(item_id,size,qty)', { count: 'exact' })
      .eq('movement_lines.item_id', id).is('voided_at', null)
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(20)
      .then(({ data, count }) => { if (live && data) setHist({ rows: data as Movement[], count: count ?? data.length }) })
    return () => { live = false }
  }, [id, d.recent])

  if (!it) return (
    <div className="col" style={{ padding: 24, gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>This item is no longer in the system.</b><button className="x" onClick={ui.closeDrawer} aria-label="Close">×</button></div>
    </div>
  )

  const X = S[it.id], sizes = rg(it.size_from, it.size_to), col = catColor(d.cats.find(c => c.id === it.category_id)?.hue, ui.dark).cc
  const hot = sizes.filter(z => (X.sz90[z] || 0) >= 2 && st(it.id, z) <= 1)
  const cw = X.cover === null ? '' : X.cover < 1 ? 'less than a week' : 'about ' + Math.round(X.cover) + ' weeks'
  const insight = X.s90 === 0
    ? 'No sales in the last 3 months. ' + X.total + ' pairs are sitting on the shelf. Consider a promotion or moving them to the front.'
    : 'Sells about ' + f1(X.wk) + ' pairs a week. ' + (X.total <= 0 ? 'There is no stock left, so every sale now is a lost sale.' : 'At that pace, current stock lasts ' + cw + '.')
      + (hot.length ? ' Size' + (hot.length > 1 ? 's ' : ' ') + hot.join(', ') + (hot.length > 1 ? ' sell well but are' : ' sells well but is') + ' nearly out. Restock these first.' : '')
  const warnInsight = hot.length || X.total <= 0 || (X.cover !== null && X.cover < 4)

  const dth = alarmTh(it, d.cats), don = dth !== null
  const alSrc = it.alarm_on !== null
    ? (it.alarm_on ? 'Set for this shoe. Pop-up when any size drops to ' + (dth === 0 ? '0' : dth + ' or less') + '.' : 'Turned off for this shoe.')
    : don ? 'On from the ' + d.catName(it.category_id) + ' category alarm.' : 'Off. No pop-ups for this shoe.'
  const pinned = d.pins.includes(it.id)

  const start = (k: Act) => { setAct(k); setInp({}); setEx({ from: '', to: '' }); setNote('') }
  async function saveAct() {
    if (!act || !it) return
    const lines: Line[] = [], deltas: Line[] = []
    if (act === 'ex') {
      if (!ex.from || !ex.to || ex.from === ex.to) return ui.toast('Pick the size brought back and a different size taken.', 'err')
      lines.push({ item_id: it.id, size: +ex.from, qty: 1 }, { item_id: it.id, size: +ex.to, qty: -1 })
    } else for (const z of sizes) {
      const n = parseInt(inp[z] ?? '')
      if (isNaN(n)) continue
      if (act === 'count') { const diff = n - st(it.id, z); if (diff) { lines.push({ item_id: it.id, size: z, qty: n }); deltas.push({ item_id: it.id, size: z, qty: diff }) } }
      else if (n > 0) lines.push({ item_id: it.id, size: z, qty: act === 'sale' ? -n : n })
    }
    if (!lines.length) return ui.toast(act === 'count' ? 'Your counts match the stock card. Nothing to change.' : 'Type at least one number in the grid.', act === 'count' ? 'info' : 'err')
    const pairs = lines.reduce((a, l) => a + Math.abs(l.qty), 0)
    const msg = act === 'count' ? 'Stock count saved · ' + plural(lines.length, 'size') + ' corrected' : act === 'ex' ? 'Size exchange saved · stock updated' : { sale: 'Sale saved', in: 'Stock in saved', ret: 'Return saved' }[act] + ' · ' + plural(pairs, 'pair') + ' · stock updated'
    setBusy(true)
    const ok = await ui.record(TYPE[act], isoDay(), note, lines, msg, act === 'count' ? deltas : lines)
    setBusy(false)
    if (ok) setAct(null)
  }

  const grid = act && act !== 'ex' ? sizes.map(z => {
    const now = st(it.id, z), n = parseInt(inp[z] ?? '')
    const after = isNaN(n) ? now : act === 'count' ? n : act === 'sale' ? now - n : now + n
    return { z, now, after, color: after < 0 ? 'var(--neg)' : after !== now ? 'var(--acc-text)' : 'var(--muted)' }
  }) : []
  const actBtn = (k: 'sale' | 'in', label: string) => (
    <button onClick={() => start(k)} className="btn hov-bright" style={{ flex: '1 1 160px', height: 48, border: 0, background: 'var(--c-' + k + ')', color: btnInk(ui.dark), fontWeight: 700, fontSize: 15, boxShadow: act === k ? '0 0 0 3px var(--surface), 0 0 0 5px var(--c-' + k + ')' : 'none' }}>{label}</button>
  )
  const todayIso = isoDay(today)

  return (
    <>
      <div style={{ position: 'relative', padding: '22px 24px 18px', background: 'var(--acc-soft)', borderBottom: '1px solid var(--acc-line)' }}>
        <div className="topbar" />
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div className="col" style={{ minWidth: 0, gap: 4 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: col }} /><span style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{it.code}</span> · {d.catName(it.category_id)}</span></div>
            <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.02em' }}>{it.tag}</h2>
            <div className="muted" style={{ fontSize: 14 }}>{it.colour} · {it.details}{it.note ? ' · Note: ' + it.note : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
            <button onClick={() => ui.togglePin(it.id)} style={{ height: 36, padding: '0 12px', border: '1px solid ' + (pinned ? 'var(--acc)' : 'var(--line)'), borderRadius: 8, background: pinned ? 'var(--acc)' : 'var(--surface)', color: pinned ? 'var(--acc-ink)' : 'var(--ink)', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{pinned ? 'Pinned' : 'Pin'}</button>
            <button onClick={() => ui.openEdit(it)} className="btn" style={{ height: 36, padding: '0 12px', borderRadius: 8, background: 'var(--surface)', fontSize: 13 }}>Edit item</button>
            <button onClick={ui.closeDrawer} aria-label="Close" className="x">×</button>
          </div>
        </div>
      </div>
      <div className="col" style={{ flex: 1, overflow: 'auto', padding: '22px 24px 40px', gap: 22 }}>
        <div style={{ padding: '14px 16px', borderRadius: 12, background: warnInsight ? 'var(--warn-soft)' : 'var(--sunk)', fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>{insight}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(66px,1fr))', gap: 8 }}>
          {sizes.map(z => {
            const v = st(it.id, z), sd = X.sz30[z] || 0
            return (
              <div key={z} title={'Size ' + z + ': ' + v + ' in stock, ' + sd + ' sold in 30 days'} className="col" style={{ padding: '8px 6px 7px', borderRadius: 10, border: '1px solid ' + (v < 0 ? 'var(--neg)' : v === 1 ? 'var(--warn)' : 'var(--line)'), background: v < 0 ? 'var(--neg-soft)' : v === 0 ? 'var(--sunk)' : v === 1 ? 'var(--warn-soft)' : 'var(--surface)', textAlign: 'center', gap: 2 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Size {z}</div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.05, color: v < 0 ? 'var(--neg)' : v === 0 ? 'var(--muted)' : v === 1 ? 'var(--warn)' : 'var(--ink)' }}>{v}</div>
                <div className="muted" style={{ fontSize: 10 }}>{sd ? 'sold ' + sd : 'no sales'}</div>
              </div>
            )
          })}
        </div>
        <AlarmRow tinted on={don} th={don ? dth : 2} src={alSrc} onToggle={() => ui.setItemAlarm(it.id, !don, don ? dth : 2)} onTh={v => ui.setItemAlarm(it.id, true, v, true)} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, padding: '12px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          {[['In stock', X.total + ' pairs'], ['Sold, 30 days', X.s30], ['Sold, 12 months', X.s365], ['Last sale', X.last === null ? 'None' : fmtDay(agoDay(X.last, today), today, true)]].map(([l, v]) => (
            <div key={l} style={{ minWidth: 0 }}><div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{l}</div><div style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap' }}>{v}</div></div>
          ))}
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actBtn('sale', 'Record a sale')}{actBtn('in', 'Record stock in')}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <a onClick={() => start('ret')}>Customer return</a>
            <a onClick={() => start('count')}>Stock count / correction</a>
            <a onClick={() => start('ex')}>Size exchange</a>
          </div>
        </div>

        {act && (
          <section style={{ border: '1px solid var(--acc-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--sunk)' }}>
              <div><div style={{ fontWeight: 700, fontSize: 15 }}>{AT[act][0]}</div><div className="muted" style={{ fontSize: 12 }}>{AT[act][1]}</div></div>
              <button onClick={() => setAct(null)} className="btn" style={{ height: 32, padding: '0 10px', border: 0, borderRadius: 8, fontSize: 13, color: 'var(--muted)' }}>Cancel</button>
            </div>
            {act !== 'ex' ? (
              <div style={{ overflowX: 'auto', padding: '12px 16px' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
                  <tbody>
                    <tr><td className="muted" style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px 4px 0', whiteSpace: 'nowrap' }}>Size</td>{grid.map(g => <td key={g.z} className="muted" style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '4px 2px' }}>{g.z}</td>)}</tr>
                    <tr><td className="muted" style={{ fontSize: 12, padding: '4px 10px 4px 0', whiteSpace: 'nowrap' }}>In stock now</td>{grid.map(g => <td key={g.z} className="muted" style={{ textAlign: 'center', padding: '4px 2px' }}>{g.now}</td>)}</tr>
                    <tr><td style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px 4px 0', whiteSpace: 'nowrap' }}>{AT[act][2]}</td>{grid.map(g => <td key={g.z} style={{ padding: '3px 2px' }}><input type="number" min={0} inputMode="numeric" className="inp" value={inp[g.z] ?? ''} onChange={e => setInp(x => ({ ...x, [g.z]: e.target.value }))} aria-label={'Size ' + g.z} style={{ width: 46, height: 40, textAlign: 'center', borderRadius: 8, fontWeight: 700, fontSize: 15, padding: 0 }} /></td>)}</tr>
                    <tr><td className="muted" style={{ fontSize: 12, padding: '4px 10px 4px 0', whiteSpace: 'nowrap' }}>After saving</td>{grid.map(g => <td key={g.z} style={{ textAlign: 'center', padding: '4px 2px', fontWeight: 700, color: g.color }}>{g.after}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '14px 16px', alignItems: 'flex-end' }}>
                {(['from', 'to'] as const).map((k, i) => (
                  <span key={k} style={{ display: 'contents' }}>
                    {i === 1 && <span className="muted" style={{ paddingBottom: 10 }}>→</span>}
                    <label className="lbl">{k === 'from' ? 'Size brought back' : 'Size taken instead'}
                      <select className="inp" value={ex[k]} onChange={e => setEx({ ...ex, [k]: e.target.value })} style={{ height: 42, padding: '0 10px', borderRadius: 8 }}>
                        <option value="">Pick size</option>
                        {sizes.map(z => <option key={z} value={z}>Size {z} ({st(it.id, z)} left)</option>)}
                      </select>
                    </label>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder={AT[act][4]} style={{ flex: '1 1 180px', height: 42, borderRadius: 8 }} />
              <button onClick={saveAct} disabled={busy} className="btn btn-acc" style={{ height: 42, padding: '0 18px', borderRadius: 8 }}>{busy ? 'Saving…' : AT[act][3]}</button>
            </div>
          </section>
        )}

        <section className="col" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><h3 style={{ margin: 0, fontSize: 15 }}>Pairs sold per month</h3><span className="muted" style={{ fontSize: 12 }}>Last 12 months</span></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, paddingTop: 16 }}>
            {X.mon.map((v, k) => {
              const m = monthName(k, today), mmax = Math.max(1, ...X.mon)
              return (
                <div key={k} title={m + ': ' + v + ' pairs'} className="col" style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' }}>
                  <span className="muted" style={{ fontSize: 10 }}>{v || ''}</span>
                  <span style={{ width: '100%', maxWidth: 26, height: Math.round((v / mmax) * 100) + '%', minHeight: 2, borderRadius: '4px 4px 0 0', background: 'var(--acc)', opacity: k === 11 ? 0.55 : 1 }} />
                  <span className="muted" style={{ fontSize: 10 }}>{m.slice(0, 1)}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="col" style={{ gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8 }}><h3 style={{ margin: 0, fontSize: 15 }}>History</h3><span className="muted" style={{ fontSize: 12 }}>{hist ? 'Latest ' + hist.rows.length + ' of ' + hist.count : 'Loading…'}</span></div>
          {hist?.rows.map(m => {
            const q = m.movement_lines.reduce((a, l) => a + l.qty, 0)
            const who = m.created_by ? d.people[m.created_by]?.display_name : 'Import'
            const canUndo = isoDay(new Date(m.created_at)) === todayIso && (d.isAdmin || m.created_by === d.me.id)
            return (
              <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '86px minmax(0,1fr) auto', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', alignItems: 'start' }}>
                <div className="muted" style={{ fontSize: 12, paddingTop: 2 }}>{fmtDay(m.occurred_on, today, true)}</div>
                <div className="col" style={{ minWidth: 0, gap: 2 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{LBL[m.type]}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{m.movement_lines.map(l => l.size + '×' + Math.abs(l.qty)).join('  ')}</div>
                  {m.note && <div className="muted" style={{ fontSize: 12 }}>{m.note}</div>}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}><span className="muted">By {who}</span>{canUndo && <a onClick={() => ui.undo(m.id, m.type === 'sold' ? 'Sale' : LBL[m.type])}>Undo</a>}</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: q < 0 ? 'var(--ink)' : 'var(--acc-text)' }}>{(q > 0 ? '+' : q < 0 ? '−' : '±') + Math.abs(q)}</div>
              </div>
            )
          })}
        </section>
      </div>
    </>
  )
}

