import { useEffect, useState, type KeyboardEvent } from 'react'
import { useData } from '../lib/data.tsx'
import { catColor, btnInk } from '../lib/theme.ts'
import { alarmTh, f1, fmtDay, isoDay, plural, rg, search, type Item } from '../lib/stats.ts'
import { useUi, newLine, focusId, PageHeader, type EntryLine } from '../ui.tsx'

/** New sale / Stock in: several lines of item → size → pairs, saved in one go. */
export function Entry() {
  const d = useData(), ui = useUi()
  const { mode, lines, setLines, narrow, dark } = ui
  const isSale = mode === 'sale'
  const [active, setActive] = useState<number | null>(null)
  const [hl, setHl] = useState(0)
  const [date, setDate] = useState(() => isoDay())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!lines[0].q) focusId('li' + lines[0].id) }, [])

  const setLine = (id: number, p: Partial<EntryLine>) => setLines(ls => ls.map(l => (l.id === id ? { ...l, ...p } : l)))
  const addLine = () => { const nl = newLine(); setLines(ls => [...ls, nl]); focusId('li' + nl.id) }
  const removeLine = (id: number) => {
    if (lines.length > 1) return setLines(ls => ls.filter(l => l.id !== id))
    const nl = newLine(); setLines([nl]); focusId('li' + nl.id)
  }
  const setModeFocus = (m: 'sale' | 'in') => { ui.setMode(m); focusId('li' + lines[0].id) }
  const pick = (lid: number, it: Item) => { setLine(lid, { it: it.id, q: it.tag, size: '' }); setActive(null); focusId('ls' + lid) }

  function setSize(ln: EntryLine, v: string) {
    const it = ln.it ? d.byId(ln.it) : undefined
    if (v && it && isSale) {
      const th = alarmTh(it, d.cats), now = d.st(it.id, +v)
      if (th !== null && now <= th) ui.toast('Alarm · ' + it.tag + ' size ' + v + (now <= 0 ? ' is sold out' : ' has only ' + now + ' left'), 'warn')
    }
    setLine(ln.id, { size: v, pairs: ln.pairs || (v ? '1' : '') })
    if (v) focusId('lp' + ln.id, true)
  }

  function itemKey(ln: EntryLine, e: KeyboardEvent, sug: Item[]) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(Math.min(hl + 1, Math.max(0, sug.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(Math.max(hl - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) return save()
      if (ln.it) focusId('ls' + ln.id)
      else if (sug[hl]) pick(ln.id, sug[hl])
    } else if (e.key === 'Escape') setActive(null)
  }
  function pairsKey(ln: EntryLine, e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) return save()
    const i = lines.findIndex(l => l.id === ln.id)
    if (i === lines.length - 1) addLine(); else focusId('li' + lines[i + 1].id)
  }

  async function save() {
    if (busy) return
    const done = (l: EntryLine) => l.it && l.size && parseInt(l.pairs) > 0
    const ok = lines.filter(done), skipped = lines.filter(l => l.q && !done(l)).length
    if (!ok.length) return ui.toast('Nothing to save yet. Pick an item, a size and the number of pairs.', 'err')
    const sign = isSale ? -1 : 1
    const ls = ok.map(l => ({ item_id: l.it!, size: +l.size, qty: sign * parseInt(l.pairs) }))
    const pairs = ls.reduce((a, l) => a + Math.abs(l.qty), 0)
    setBusy(true)
    const saved = await ui.record(isSale ? 'sold' : 'in', date, note, ls, (isSale ? 'Sale saved' : 'Stock in saved') + ' · ' + plural(pairs, 'pair') + ' · stock updated' + (skipped ? ' · ' + skipped + ' unfinished line skipped' : ''))
    setBusy(false)
    if (!saved) return // keep the lines so nothing typed is lost
    const nl = newLine(); setLines([nl]); setNote(''); setActive(null); focusId('li' + nl.id)
  }

  // ── per-line maths: "left after" counts earlier lines for the same size ──
  const sign = isSale ? -1 : 1, used: Record<string, number> = {}, heads: { title: string; txt: string }[] = []
  const rows = lines.map(ln => {
    const it = ln.it ? d.byId(ln.it) : undefined
    const show = active === ln.id && !it && ln.q.trim().length > 0
    const sug = show ? search(ln.q, d.live, d.catName).slice(0, 7) : []
    let now: number | null = null, after: number | null = null
    if (it && ln.size) {
      const k = it.id + '|' + ln.size, p = parseInt(ln.pairs) || 0
      now = d.st(it.id, +ln.size) + (used[k] || 0); after = now + sign * p; used[k] = (used[k] || 0) + sign * p
      const sold = d.S[it.id].sz30[+ln.size] || 0
      if (isSale && after <= 1 && p > 0) heads.push({ title: it.tag + ' size ' + ln.size + (after < 0 ? ' will go below zero.' : after === 0 ? ' will sell out.' : ' will have 1 left.'), txt: sold ? sold + ' sold in this size in the last 30 days. Add it to your next order.' : 'Not a fast seller, so no rush.' })
      if (!isSale && now <= 0) heads.push({ title: it.tag + ' size ' + ln.size + ' was sold out.', txt: sold ? sold + ' sold in the last 30 days, so this delivery is well timed.' : 'Good to have it back on the shelf.' })
    }
    const th = it ? alarmTh(it, d.cats) : null
    return { ln, it, show, sug, now, after, alarm: isSale && th !== null && after !== null && after <= th }
  })
  const total = lines.reduce((a, l) => a + (l.it && l.size ? parseInt(l.pairs) || 0 : 0), 0)

  const todayIso = isoDay(d.today), myType = isSale ? 'sold' : 'in'
  const entries = d.recent.filter(m => m.type === myType && isoDay(new Date(m.created_at)) === todayIso)
  const todaySum = (t: string) => d.recent.filter(m => m.type === t && m.occurred_on === todayIso).reduce((a, m) => a + m.movement_lines.reduce((x, l) => x + Math.abs(l.qty), 0), 0)
  const cols = narrow ? 'minmax(0,1fr) minmax(0,1fr) 40px' : 'minmax(0,2.4fr) minmax(0,1.4fr) 92px 130px 40px'
  const cc = (it: Item) => catColor(d.cats.find(c => c.id === it.category_id)?.hue, dark).cc
  const inp = { width: '100%', height: 46, padding: '0 14px', fontSize: 15 }

  const toggleBtn = (on: boolean, label: string, sub: string, sym: string, key: 'sale' | 'in') => (
    <button role="tab" aria-selected={on} onClick={() => setModeFocus(key)} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 80, padding: '12px 22px', border: 0, borderRadius: 15, background: on ? 'var(--c-' + key + ')' : 'transparent', color: on ? btnInk(dark) : 'var(--muted)', cursor: 'pointer', textAlign: 'left', transition: 'background 220ms,color 220ms' }}>
      <span style={{ width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: '0 0 auto', background: on ? 'rgba(255,255,255,.22)' : 'var(--c-' + key + ')', color: on ? 'inherit' : btnInk(dark), fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{sym}</span>
      <span className="col" style={{ gap: 2 }}><span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-.01em' }}>{label}</span><span style={{ fontSize: 13, opacity: 0.85 }}>{sub}</span></span>
    </button>
  )

  return (
    <>
      <PageHeader eyebrow={isSale ? 'Money in' : 'Goods arriving'} title={isSale ? 'New sale' : 'Stock in'}
        sub={isSale ? 'Key in what was sold. Stock goes down as you save.' : 'Key in a delivery from a supplier. Stock goes up as you save.'}
        right={
          <div role="tablist" aria-label="Sale or stock in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 20, width: narrow ? '100%' : 'min(480px,100%)', boxShadow: '0 4px 14px rgba(0,0,0,.06)' }}>
            {toggleBtn(isSale, 'Sale', 'Stock goes down', '−', 'sale')}
            {toggleBtn(!isSale, 'Stock in', 'Stock goes up', '+', 'in')}
          </div>
        } />
      <div className="page-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div className="col" style={{ flex: '1 1 560px', minWidth: 0, gap: 24 }}>
          <section className="card" style={{ boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
            {!narrow && (
              <div className="eyebrow" style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '14px 20px 10px' }}>
                <div>Item</div><div>Size</div><div>Pairs</div><div>Left after</div><div />
              </div>
            )}
            {rows.map(({ ln, it, show, sug, now, after, alarm }) => (
              <div key={ln.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '12px 20px', borderTop: '1px solid var(--line)', alignItems: 'start' }}>
                <div style={{ position: 'relative', gridColumn: narrow ? '1 / -1' : 'auto', minWidth: 0 }}>
                  <input id={'li' + ln.id} className="inp" value={ln.q} autoComplete="off" aria-label="Item" placeholder="Type an item: y329, capal black, 2146"
                    onChange={e => { setLine(ln.id, { q: e.target.value, it: null, size: '' }); setActive(ln.id); setHl(0) }}
                    onKeyDown={e => itemKey(ln, e, sug)} onFocus={() => { setActive(ln.id); setHl(0) }} onBlur={() => setTimeout(() => setActive(a => (a === ln.id ? null : a)), 150)}
                    style={{ ...inp, fontWeight: it ? 600 : 400 }} />
                  {it && <div className="muted ell" style={{ fontSize: 12, padding: '5px 2px 0' }}>{it.colour} · {it.details}{it.note ? ' · ' + it.note : ''} · {d.S[it.id].total} in stock</div>}
                  {show && (
                    <div role="listbox" style={{ position: 'absolute', top: 50, left: 0, right: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,.16)', padding: 6, maxHeight: 340, overflow: 'auto' }}>
                      {sug.map((x, i) => {
                        const t = d.S[x.id].total
                        return (
                          <button key={x.id} role="option" aria-selected={i === hl} onMouseDown={e => { e.preventDefault(); pick(ln.id, x) }} className="hov" style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: 0, borderRadius: 8, background: i === hl ? 'var(--acc-soft)' : 'transparent', textAlign: 'left', cursor: 'pointer' }}>
                            <span className="col" style={{ minWidth: 0 }}>
                              <b style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: cc(x), flex: '0 0 auto' }} />{x.tag}</b>
                              <span className="muted ell" style={{ fontSize: 12 }}>{x.colour} · {x.details}</span>
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: t <= 0 ? 'var(--neg)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{t} in stock</span>
                          </button>
                        )
                      })}
                      {!sug.length && <div className="muted" style={{ padding: 12, fontSize: 13 }}>No item matches “{ln.q}”.{d.isAdmin && <> <a onMouseDown={e => { e.preventDefault(); ui.go('stock'); ui.openEdit(null) }}>Add a new item</a></>}</div>}
                      <div className="muted" style={{ padding: '6px 12px 2px', fontSize: 11 }}>↑ ↓ to move · Enter to pick</div>
                    </div>
                  )}
                </div>
                <select id={'ls' + ln.id} className="inp" value={ln.size} onChange={e => setSize(ln, e.target.value)} disabled={!it} aria-label="Size" style={{ ...inp, padding: '0 10px', opacity: it ? 1 : 0.55 }}>
                  <option value="">Size</option>
                  {it && rg(it.size_from, it.size_to).map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                <input id={'lp' + ln.id} className="inp" type="number" min={1} inputMode="numeric" value={ln.pairs} onChange={e => setLine(ln.id, { pairs: e.target.value })} onKeyDown={e => pairsKey(ln, e)} aria-label="Pairs" placeholder="0" style={{ ...inp, padding: '0 12px', fontSize: 17, fontWeight: 600 }} />
                <div className="col" style={{ minHeight: 46, justifyContent: 'center', ...(narrow && { gridColumn: '1 / -1', order: 1 }) }}>
                  <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: after === null ? 'var(--muted)' : after < 0 ? 'var(--neg)' : after <= 1 ? 'var(--warn)' : 'var(--ink)' }}>{after === null ? '—' : after}</div>
                  {after !== null && after < 0 && <div style={{ fontSize: 12, color: 'var(--neg)', fontWeight: 600, paddingTop: 4 }}>Below zero. Check the shelf. You can still save.</div>}
                  {alarm && <div style={{ marginTop: 5, alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--neg-soft)', color: 'var(--neg)' }}>Alarm · {after! <= 0 ? 'will sell out' : 'drops to alarm level'}</div>}
                  {now !== null && !(after! < 0) && <div className="muted" style={{ fontSize: 12, paddingTop: 3 }}>now {now}</div>}
                </div>
                <button onClick={() => removeLine(ln.id)} aria-label="Remove line" title="Remove line" className="hov" style={{ flexShrink: 0, width: 40, height: 46, border: 0, borderRadius: 10, color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
              </div>
            ))}
            <div style={{ padding: '6px 20px 16px' }}>
              <button onClick={addLine} className="btn" style={{ border: '1px dashed var(--acc-line)', color: 'var(--acc-text)', padding: '0 12px' }}>+ Add another item</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', padding: '18px 20px', borderTop: '1px solid var(--line)', background: 'var(--sunk)', borderRadius: '0 0 16px 16px' }}>
              <label className="lbl">Date
                <input type="date" className="inp" value={date} max={isoDay()} onChange={e => setDate(e.target.value || isoDay())} style={{ background: 'var(--surface)' }} />
              </label>
              <label className="lbl" style={{ flex: '1 1 220px' }}>{isSale ? 'Receipt no.' : 'Supplier / invoice no.'}
                <input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder={isSale ? 'e.g. 4821' : 'e.g. JLG invoice 2207'} style={{ background: 'var(--surface)' }} />
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginLeft: 'auto' }}>
                <div style={{ textAlign: 'right' }}>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Total</div>
                  <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{plural(total, 'pair')}</div>
                </div>
                <button onClick={save} disabled={busy} className="btn btn-acc" style={{ height: 56, padding: '0 28px', borderRadius: 12, fontSize: 17, boxShadow: '0 6px 18px -8px var(--acc)' }}>{busy ? 'Saving…' : isSale ? 'Save sale' : 'Save stock in'}</button>
              </div>
            </div>
          </section>
          {!narrow && (
            <div className="muted" style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <span><b style={{ color: 'var(--ink)' }}>Enter</b> picks the item, then the size</span>
              <span><b style={{ color: 'var(--ink)' }}>Enter</b> in Pairs adds the next line</span>
              <span><b style={{ color: 'var(--ink)' }}>Ctrl + Enter</b> saves</span>
            </div>
          )}

          <section className="col" style={{ gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{isSale ? 'Sales keyed in today' : 'Deliveries keyed in today'}</h2>
              <span className="muted" style={{ fontSize: 12 }}>Latest first</span>
            </div>
            {!entries.length && <div className="muted" style={{ padding: 22, border: '1px dashed var(--line)', borderRadius: 14, fontSize: 13 }}>{isSale ? 'Nothing yet today. Sales you save appear here with an Undo button.' : 'Nothing yet today. Deliveries you save appear here with an Undo button.'}</div>}
            {entries.map(m => {
              const who = m.created_by ? d.people[m.created_by]?.display_name : ''
              const meta = [m.occurred_on === todayIso ? 'Today' : fmtDay(m.occurred_on, d.today, true), new Date(m.created_at).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' }), who, m.note].filter(Boolean).join(' · ')
              const pairs = m.movement_lines.reduce((a, l) => a + Math.abs(l.qty), 0)
              return (
                <div key={m.id} className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '14px 18px', borderRadius: 14 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--acc)', marginTop: 7, flex: '0 0 auto' }} />
                  <div className="col" style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    {m.movement_lines.map((l, i) => <div key={i} style={{ fontSize: 14 }}><b>{d.byId(l.item_id)?.tag}</b> <span className="muted">· size {l.size} ×</span> <b>{Math.abs(l.qty)}</b></div>)}
                    <div className="muted" style={{ fontSize: 12 }}>{meta}</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap' }}>{(isSale ? '−' : '+') + pairs}</div>
                  {(d.isAdmin || m.created_by === d.me.id) && <button onClick={() => ui.undo(m.id, isSale ? 'Sale' : 'Received')} className="btn" style={{ height: 34, padding: '0 12px', borderRadius: 8, fontSize: 13 }}>Undo</button>}
                </div>
              )
            })}
          </section>
        </div>

        <aside className="side">
          <section className="card col" style={{ padding: 18, gap: 12 }}>
            <div className="eyebrow">Today</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{todaySum('sold')}</div><div className="muted" style={{ fontSize: 12, paddingTop: 4 }}>pairs sold</div></div>
              <div><div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{todaySum('in')}</div><div className="muted" style={{ fontSize: 12, paddingTop: 4 }}>pairs received</div></div>
            </div>
          </section>
          {heads.length > 0 && (
            <section className="col" style={{ padding: 18, background: 'var(--warn-soft)', border: '1px solid var(--line)', borderRadius: 16, gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Heads-up for this {isSale ? 'sale' : 'delivery'}</div>
              {heads.slice(0, 4).map((h, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.45, textWrap: 'pretty' }}><b>{h.title}</b> {h.txt}</div>)}
            </section>
          )}
          {d.isAdmin && (
            <section className="card col" style={{ padding: 18, gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Running low: restock soon</div>
                <div className="muted" style={{ fontSize: 12, textWrap: 'pretty' }}>Less than 4 weeks left at the last 3 months' pace.</div>
              </div>
              {!d.restock.length && <div className="muted" style={{ fontSize: 13 }}>Nothing is running low.</div>}
              {d.restock.slice(0, 5).map(i => (
                <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button onClick={() => ui.openItem(i.id)} className="row-btn" style={{ flex: 1, minWidth: 0 }}>
                    <div className="ell" style={{ fontSize: 14, fontWeight: 600 }}>{i.tag}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{d.S[i.id].total} left · sells {f1(d.S[i.id].wk)} a week</div>
                  </button>
                  <button onClick={() => ui.restockLine(i)} title="Add to a stock in" className="btn" style={{ height: 32, padding: '0 10px', borderRadius: 8, fontSize: 12 }}>+ Stock in</button>
                </div>
              ))}
              <a onClick={() => ui.go('stock')} style={{ fontSize: 13 }}>See all stock health →</a>
            </section>
          )}
        </aside>
      </div>
    </>
  )
}
