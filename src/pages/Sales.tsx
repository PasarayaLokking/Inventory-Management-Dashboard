import { useState } from 'react'
import { useData } from '../lib/data.tsx'
import { fetchAll } from '../lib/supabase.ts'
import { catColor, btnInk } from '../lib/theme.ts'
import { LBL, SYS, agoDay, coverWords, f1, fmtDay, inSum, isoDay, monthName, n0, rg, toCsv, trendOf, type Item, type ItemStat, type MoveType } from '../lib/stats.ts'
import { useUi, PageHeader, MoveIcon, download } from '../ui.tsx'

const PERIODS = [[7, '7 days', 's7'], [30, '30 days', 's30'], [90, '3 months', 's90'], [365, '12 months', 's365']] as const
const trTxt = (c: number | null) => (c === null ? '—' : (c > 0 ? '+' : '') + c + '%')
const trCol = (c: number | null) => (c === null ? 'var(--muted)' : c > 10 ? 'var(--acc-text)' : c < -10 ? 'var(--neg)' : 'var(--ink)')
const coverCol = (X: ItemStat) => (X.total <= 0 ? 'var(--neg)' : X.cover !== null && X.cover < 4 ? 'var(--warn)' : 'var(--ink)')

export function Sales() {
  const d = useData(), ui = useUi(), { S, st, today } = d, dark = ui.dark
  const [period, setPeriod] = useState<7 | 30 | 90 | 365>(30)
  const [trendId, setTrendId] = useState<string | null>(null)
  const [cmpIds, setCmpIds] = useState<string[] | null>(null)

  const [, PL, key] = PERIODS.find(p => p[0] === period)!
  const cc = (it: Item) => catColor(d.cats.find(c => c.id === it.category_id)?.hue, dark).cc
  const months = rg(0, 11).map(k => monthName(k, today))
  const pinBtn = (pinned: boolean) => ({ border: '1px solid ' + (pinned ? 'var(--acc)' : 'var(--line)'), background: pinned ? 'var(--acc)' : 'var(--surface)', color: pinned ? 'var(--acc-ink)' : 'var(--ink)' })

  // ── period figures ──
  const rk = d.live.map(it => ({ it, n: S[it.id][key] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)
  const sold = rk.reduce((a, x) => a + x.n, 0), top = rk[0], mx = top ? top.n : 1
  // returns in the period: per shoe, per shoe+size, total
  const retBy = inSum(d.ins, 'ret', period, today), retSz = inSum(d.ins, 'ret', period, today, r => r.item_id + '|' + r.size)
  const retN = Object.values(retBy).reduce((a, n) => a + n, 0)
  const retList = d.items.filter(i => retBy[i.id]).sort((a, b) => retBy[b.id] - retBy[a.id])
  const tiles = [
    { label: 'Pairs sold', value: n0(sold), sub: 'About ' + f1(sold / (period / 7)) + ' pairs a week' },
    { label: 'Best seller', value: top ? top.it.tag : '—', sub: top ? top.n + ' pairs · ' + S[top.it.id].coverTxt + ' of stock left' : 'No sales' },
    { label: 'Pairs returned', value: n0(retN), sub: sold ? Math.round((retN / sold) * 100) + '% of pairs sold' : 'No sales to compare', ret: true },
  ]
  const restockSales = rk.filter(x => { const X = S[x.it.id]; return X.total <= 0 || (X.cover !== null && X.cover < 4) }).slice(0, 6)
  const stockPos = d.live.reduce((a, i) => a + Math.max(0, S[i.id].total), 0) || 1
  const catSales = d.cats.map(c => {
    const its = d.live.filter(i => i.category_id === c.id)
    const cs = its.reduce((a, i) => a + S[i.id][key], 0), ck = its.reduce((a, i) => a + Math.max(0, S[i.id].total), 0)
    const sp = sold ? (cs / sold) * 100 : 0, kp = (ck / stockPos) * 100, diff = sp - kp
    return { id: c.id, name: c.name, cs, sp, kp, verdict: !its.length ? 'No items' : diff > 4 ? 'Selling faster than you stock it' : diff < -4 ? 'More stock than it sells' : 'Stock matches sales', vc: diff > 4 ? 'var(--warn)' : diff < -4 ? 'var(--acc-text)' : 'var(--muted)' }
  })
  const slowPairs = d.slow.reduce((a, i) => a + S[i.id].total, 0)

  // ── one shoe ──
  const byS = d.live.slice().sort((a, b) => S[b.id].s365 - S[a.id].s365)
  const trI = (trendId && d.live.find(i => i.id === trendId)) || byS[0]

  // ── compare ──
  const COLS = dark ? ['oklch(0.78 0.14 150)', 'oklch(0.76 0.13 255)', 'oklch(0.78 0.14 50)', 'oklch(0.76 0.14 320)', 'oklch(0.8 0.1 200)'] : ['oklch(0.52 0.15 150)', 'oklch(0.5 0.16 255)', 'oklch(0.6 0.17 45)', 'oklch(0.5 0.17 320)', 'oklch(0.52 0.1 200)']
  const cmp = (cmpIds ?? byS.slice(0, 4).map(i => i.id)).filter(id => d.live.some(i => i.id === id))
  const series = cmp.map((id, i) => { const X = S[id]; return { id, it: d.byId(id)!, X, color: COLS[i % 5], sum: X.mon.reduce((a, b) => a + b, 0), ch: trendOf(X.mon) } })
  const cmax = Math.max(1, ...series.flatMap(x => x.X.mon)), yv = (v: number) => 190 - (v / cmax) * 180
  let cIns = ''
  if (series.length) {
    const best = series.slice().sort((a, b) => b.sum - a.sum)[0]
    const grow = series.filter(x => x.ch !== null).sort((a, b) => b.ch! - a.ch!)[0]
    const tight = series.filter(x => x.X.total <= 0 || (x.X.cover !== null && x.X.cover < 4)).sort((a, b) => (a.X.cover || 0) - (b.X.cover || 0))[0]
    cIns = best.it.tag + ' sold the most (' + best.sum + ' pairs in 12 months).'
      + (grow && grow.ch! > 10 && grow !== best ? ' ' + grow.it.tag + ' is growing fastest (' + trTxt(grow.ch) + ').' : grow && grow.ch! > 10 ? ' It is also growing fastest (' + trTxt(grow.ch) + ').' : '')
      + (tight ? ' ' + tight.it.tag + (tight.X.total <= 0 ? ' is sold out.' : ' has only ' + coverWords(tight.X) + ' of stock left at its current pace.') : ' All of these have at least 4 weeks of stock.')
  }

  // ── pins ──
  const pins = d.pins.map(d.byId).filter((i): i is Item => !!i && !i.removed_at).map(it => {
    const X = S[it.id], w = X.weekly, diff = w[7] - w[6], mxw = Math.max(1, ...w)
    const low = X.sizes.filter(z => st(it.id, z) <= 1 && (X.sz90[z] || 0) > 0), out = low.filter(z => st(it.id, z) <= 0), last = low.filter(z => !out.includes(z))
    const note = low.length ? (out.length ? 'Sold out: size ' + out.join(', ') + '. ' : '') + (last.length ? 'Last pair: size ' + last.join(', ') + '.' : '') : 'Every size that sells has stock.'
    return { it, X, w, diff, mxw, low, note }
  })

  async function csvSales() {
    ui.toast('Preparing the download…', 'info')
    type Row = { size: number; qty: number; item_id: string; movement: { type: MoveType; occurred_on: string; note: string; voided_at: string | null; created_by: string | null } }
    const rows = (await fetchAll<Row>('movement_lines', 'size,qty,item_id,movement:movements(type,occurred_on,note,voided_at,created_by)', ['id']).catch(() => null))
    if (!rows) return ui.toast('Download failed. Check the connection and try again.', 'err')
    const out = rows.filter(r => !r.movement.voided_at).sort((a, b) => a.movement.occurred_on.localeCompare(b.movement.occurred_on))
      .map(r => [r.movement.occurred_on, d.byId(r.item_id)?.tag, LBL[r.movement.type], r.size, r.qty, r.movement.note, r.movement.created_by ? d.people[r.movement.created_by]?.display_name : ''])
    download('sales-supply-returns-' + isoDay() + '.csv', toCsv([['Date', 'Item', 'Action', 'Size', 'Pairs', 'Note', 'By'], ...out]))
    ui.toast('Downloaded all sales, supply & returns', 'info')
  }

  const showInChart = (id: string) => { setTrendId(id); document.getElementById('one-shoe')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const head = (eyebrow: string, title: string, sub?: string) => (
    <div style={{ minWidth: 0 }}>
      <div className="eyebrow">{eyebrow}</div>
      <h2 style={{ margin: '4px 0 0', fontSize: 21, letterSpacing: '-.01em' }}>{title}</h2>
      {sub && <div className="muted" style={{ fontSize: 13, textWrap: 'pretty' }}>{sub}</div>}
    </div>
  )
  const legend = (items: [string, number][]) => (
    <div className="muted" style={{ display: 'flex', gap: 14, fontSize: 11 }}>
      {items.map(([l, op]) => <span key={l} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 12, height: 8, borderRadius: 2, background: op === 1 ? 'var(--acc)' : 'var(--muted)', opacity: op }} />{l}</span>)}
    </div>
  )

  return (
    <>
      <PageHeader eyebrow="Results" title="Sales" sub="What sold, and whether your stock keeps up with it."
        right={
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }}>
            {PERIODS.map(([p, label]) => <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} style={{ whiteSpace: 'nowrap', height: 38, padding: '0 14px', border: 0, borderRadius: 8, background: period === p ? 'var(--acc)' : 'transparent', color: period === p ? 'var(--acc-ink)' : 'var(--ink)', fontWeight: 600, cursor: 'pointer', transition: 'background 200ms' }}>{label}</button>)}
          </div>
        } />
      <div className="page-body col" style={{ gap: 24 }}>
        {/* pinned */}
        <section className="col" style={{ padding: 20, borderRadius: 18, background: 'var(--acc-soft)', border: '1px solid var(--acc-line)', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 0, flex: '1 1 320px' }}>
              <div className="eyebrow" style={{ fontWeight: 700, color: 'var(--acc-text)' }}>Pinned · always watched</div>
              <h2 style={{ margin: '4px 0 0', fontSize: 22, letterSpacing: '-.01em' }}>Shoes you are keeping an eye on</h2>
              <div className="muted" style={{ fontSize: 13, textWrap: 'pretty', paddingTop: 2 }}>Pin any shoe from the chart, the Best sellers table or its item card. Pinned shoes stay at the top of this page and in the sidebar on every page.</div>
            </div>
            {pins.length < 6 && (
              <select className="inp" value="" onChange={e => e.target.value && ui.togglePin(e.target.value)} aria-label="Pin a shoe" style={{ padding: '0 12px', borderColor: 'var(--acc-line)', background: 'var(--surface)', color: 'var(--acc-text)', fontWeight: 700, maxWidth: 240 }}>
                <option value="">+ Pin a shoe</option>
                {d.live.filter(i => !d.pins.includes(i.id)).sort((a, b) => a.tag.localeCompare(b.tag)).map(i => <option key={i.id} value={i.id}>{i.tag}</option>)}
              </select>
            )}
          </div>
          {!pins.length && <div className="muted" style={{ padding: 24, border: '1px dashed var(--acc-line)', borderRadius: 14, textAlign: 'center', fontSize: 14, background: 'var(--surface)' }}>Nothing pinned yet. Pin a shoe to watch it here every day.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
            {pins.map(p => (
              <article key={p.it.id} className="card col" style={{ borderTop: '5px solid ' + cc(p.it), padding: 16, gap: 12, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: cc(p.it) }} />{d.catName(p.it.category_id)}</div>
                    <button onClick={() => ui.openItem(p.it.id)} className="row-btn hov-acc ell" style={{ display: 'block', marginTop: 2, fontSize: 18, fontWeight: 700, maxWidth: '100%' }}>{p.it.tag}</button>
                  </div>
                  <button onClick={() => ui.togglePin(p.it.id)} title="Unpin" className="btn" style={{ height: 30, padding: '0 10px', borderRadius: 8, color: 'var(--muted)', fontSize: 12 }}>Unpin</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div><div className="eyebrow" style={{ fontSize: 11 }}>Sold this week</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}><span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{p.w[7]}</span><span style={{ fontSize: 12, fontWeight: 700, color: p.diff > 0 ? 'var(--acc-text)' : p.diff < 0 ? 'var(--neg)' : 'var(--muted)' }}>{p.diff > 0 ? '▲ ' + p.diff + ' vs last week' : p.diff < 0 ? '▼ ' + -p.diff + ' vs last week' : 'same as last week'}</span></div></div>
                  <div><div className="eyebrow" style={{ fontSize: 11 }}>On the shelf</div><div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: p.X.total <= 0 ? 'var(--neg)' : 'var(--ink)' }}>{p.X.total}</div></div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 56 }}>
                    {p.w.map((v, k) => <span key={k} title={(k === 7 ? 'This week' : 7 - k + ' weeks ago') + ': ' + v + ' pairs'} style={{ flex: 1, height: Math.round((v / p.mxw) * 56), minHeight: 2, borderRadius: '3px 3px 0 0', background: cc(p.it), opacity: k === 7 ? 1 : 0.5 }} />)}
                  </div>
                  <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, paddingTop: 4 }}><span>8 weeks ago</span><span>This week</span></div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: p.low.length ? 'var(--warn)' : 'var(--muted)', textWrap: 'pretty' }}>{p.note}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => showInChart(p.it.id)} className="btn" style={{ height: 34, padding: '0 12px', borderRadius: 8, fontSize: 12 }}>Show in chart</button>
                  {p.low.length > 0 && <button onClick={() => ui.addToIn(p.low.map(z => ({ item_id: p.it.id, size: z })))} className="btn" style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 8, background: 'var(--c-in)', color: btnInk(dark), fontSize: 12, fontWeight: 700 }}>+ Stock in low sizes</button>}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 16 }}>
          {tiles.map(t => (
            <div key={t.label} className="card col" style={{ padding: 20, gap: 6, minWidth: 0 }}>
              <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{t.ret && <MoveIcon type="ret" size={14} />}{t.label}</div>
              <div className="ell" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-.02em' }}>{t.value}</div>
              <div className="muted" style={{ fontSize: 13 }}>{t.sub}</div>
            </div>
          ))}
        </div>
        {!rk.length && <div className="muted" style={{ padding: 40, border: '1px dashed var(--line)', borderRadius: 16, textAlign: 'center' }}>No sales in this period. Try a longer period.</div>}

        {/* one shoe */}
        {trI && <OneShoe it={trI} byS={byS} setTrendId={setTrendId} pinBtn={pinBtn} />}

        {/* compare */}
        <section className="card col" style={{ padding: 20, gap: 16 }}>
          {head('Compare shoes · last 12 months', 'Several shoes, month by month', 'Pick up to 5 shoes. The lines show pairs sold each month; the table gives the same numbers with stock alongside.')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {series.map(x => (
              <span key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 6px 0 12px', border: '1px solid var(--line)', borderRadius: 999, background: 'var(--surface)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                <span style={{ width: 14, height: 4, borderRadius: 2, background: x.color }} />{x.it.tag}
                <button onClick={() => setCmpIds(cmp.filter(i => i !== x.id))} aria-label={'Remove ' + x.it.tag + ' from comparison'} className="hov" style={{ width: 24, height: 24, border: 0, borderRadius: '50%', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, padding: 0 }}>×</button>
              </span>
            ))}
            {series.length < 5 && (
              <select value="" onChange={e => e.target.value && setCmpIds([...cmp, e.target.value])} aria-label="Add a shoe" style={{ height: 36, padding: '0 10px', border: '1px dashed var(--acc-line)', borderRadius: 999, background: 'transparent', color: 'var(--acc-text)', fontWeight: 600, outline: 'none', maxWidth: 220 }}>
                <option value="">+ Add a shoe</option>
                {byS.filter(i => !cmp.includes(i.id)).map(i => <option key={i.id} value={i.id}>{i.tag}</option>)}
              </select>
            )}
            <button onClick={() => setCmpIds(byS.slice(0, 5).map(i => i.id))} className="btn" style={{ marginLeft: 'auto', height: 36, padding: '0 12px', fontSize: 13 }}>Show top 5 sellers</button>
          </div>
          {!series.length && <div className="muted" style={{ padding: 32, border: '1px dashed var(--line)', borderRadius: 14, textAlign: 'center', fontSize: 14 }}>Add a shoe above to start comparing.</div>}
          {series.length > 0 && <>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--acc-soft)', fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>{cIns}</div>
            <div style={{ position: 'relative', padding: '4px 8px 0 36px' }}>
              {[cmax, Math.round(cmax / 2), 0].map((v, i) => <span key={i} className="muted" style={{ position: 'absolute', left: 0, top: (yv(v) / 200) * 220 + 4, transform: 'translateY(-50%)', fontSize: 11, width: 28, textAlign: 'right' }}>{v}</span>)}
              <svg viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label="Pairs sold per month for the compared shoes" style={{ width: '100%', height: 220, display: 'block', overflow: 'visible' }}>
                {[0, 0.5, 1].map(q => <line key={q} x1={0} x2={600} y1={yv(cmax * q)} y2={yv(cmax * q)} style={{ stroke: 'var(--line)', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} />)}
                {series.map(x => <path key={x.id} d={x.X.mon.map((v, k) => (k ? 'L' : 'M') + ((k / 11) * 600).toFixed(1) + ' ' + yv(v).toFixed(1)).join(' ')} style={{ fill: 'none', stroke: x.color, strokeWidth: 3, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }} />)}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}>{months.map((m, i) => <span key={i} className="muted" style={{ width: 0, display: 'flex', justifyContent: 'center', fontSize: 11 }}>{m}</span>)}</div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 3, fontSize: 13, minWidth: 760 }}>
                <thead><tr className="muted" style={{ fontSize: 11 }}>
                  <th style={{ textAlign: 'left', fontWeight: 600, padding: '4px 8px' }}>Shoe</th>
                  {months.map((m, i) => <th key={i} style={{ fontWeight: 600, padding: '4px 0' }}>{m}</th>)}
                  <th style={{ textAlign: 'right', fontWeight: 600, padding: '4px 8px' }}>12 mo</th>
                  <th style={{ textAlign: 'right', fontWeight: 600, padding: '4px 8px' }}>Trend</th>
                </tr></thead>
                <tbody>{series.map(x => (
                  <tr key={x.id}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><button onClick={() => ui.openItem(x.id)} className="row-btn hov-acc" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: x.color }} />{x.it.tag}</button></td>
                    {x.X.mon.map((v, k) => { const p = Math.round((v / cmax) * 85); return <td key={k} title={months[k] + ': ' + v + ' pairs'} style={{ textAlign: 'center', padding: '8px 0', borderRadius: 6, background: 'color-mix(in oklch, ' + x.color + ' ' + p + '%, var(--surface))', color: p > 50 ? (dark ? 'oklch(0.18 0 0)' : '#fff') : 'var(--ink)', fontWeight: 600, minWidth: 34 }}>{v || '–'}</td> })}
                    <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700 }}>{x.sum}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: trCol(x.ch) }}>{trTxt(x.ch)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>Darker cell = more pairs sold that month. Trend compares the last 3 full months with the 3 before.</div>
          </>}
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          <section className="card col" style={{ padding: 18, gap: 10 }}>
            <div><div style={{ fontSize: 15, fontWeight: 700 }}>Selling well, stock running out</div><div className="muted" style={{ fontSize: 12 }}>Restock these first. Under 4 weeks left.</div></div>
            {!restockSales.length && <div className="muted" style={{ fontSize: 13, padding: '8px 0', borderTop: '1px solid var(--line)' }}>Nothing urgent. Every item sold in this period has at least 4 weeks of stock.</div>}
            {restockSales.map(x => (
              <button key={x.it.id} onClick={() => ui.openItem(x.it.id)} className="row-btn hov-acc" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 14, alignItems: 'center', borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                <b className="ell" style={{ fontSize: 13 }}>{x.it.tag}</b><span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{x.n} sold · {S[x.it.id].total} left</span><span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>{S[x.it.id].coverTxt}</span>
              </button>
            ))}
          </section>
          <section className="card col" style={{ padding: 18, gap: 10 }}>
            <div><div style={{ fontSize: 15, fontWeight: 700 }}>Lots of stock, slow sales</div><div className="muted" style={{ fontSize: 12 }}>{n0(slowPairs)} pairs tied up. Consider a promotion before ordering more.</div></div>
            {d.slow.slice(0, 5).map(i => (
              <button key={i.id} onClick={() => ui.openItem(i.id)} className="row-btn hov-acc" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14, alignItems: 'center', borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                <b className="ell" style={{ fontSize: 13 }}>{i.tag}</b><span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{S[i.id].total} pairs · {S[i.id].s90 === 0 ? 'no sales in 3 months' : 'sells ' + f1(S[i.id].wk) + ' a week'}</span>
              </button>
            ))}
          </section>
          <section className="card col" style={{ padding: 18, gap: 10 }}>
            <div><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}><MoveIcon type="ret" />Returned goods · {PL}</div><div className="muted" style={{ fontSize: 12 }}>Most returned first. The reasons are in the CSV download, Note column.</div></div>
            {!retList.length && <div className="muted" style={{ fontSize: 13, padding: '8px 0', borderTop: '1px solid var(--line)' }}>No returns in this period.</div>}
            {retList.slice(0, 8).map(i => {
              const n = retBy[i.id], s = S[i.id][key]
              const sz = S[i.id].sizes.filter(z => retSz[i.id + '|' + z]).map(z => z + (retSz[i.id + '|' + z] > 1 ? ' ×' + retSz[i.id + '|' + z] : ''))
              return (
                <button key={i.id} onClick={() => ui.openItem(i.id)} className="row-btn hov-acc" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14, alignItems: 'center', borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                  <span style={{ minWidth: 0 }}><b className="ell" style={{ display: 'block', fontSize: 13 }}>{i.tag}</b><span className="muted" style={{ fontSize: 12 }}>size {sz.join(', ')}</span></span>
                  <span style={{ fontSize: 12, whiteSpace: 'nowrap', textAlign: 'right' }}><b>{n} returned</b> · {s} sold{s ? ' · ' + Math.round((n / s) * 100) + '%' : ''}</span>
                </button>
              )
            })}
            {retList.length > 8 && <div className="muted" style={{ fontSize: 12 }}>+{retList.length - 8} more in the CSV download</div>}
          </section>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          <section className="card" style={{ flex: '1 1 560px', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 18px', borderBottom: '1px solid var(--line)', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Best sellers · {PL}</h2>
              <button onClick={csvSales} className="btn" style={{ height: 34, padding: '0 12px', borderRadius: 8, fontSize: 13 }}>Download all sales, supply &amp; returns (CSV)</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr className="muted" style={{ background: 'var(--sunk)', fontSize: 12 }}>
                  <th style={{ textAlign: 'left', padding: '8px 18px', fontWeight: 600, width: 36 }}>#</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Item</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600, minWidth: 160 }}>Pairs sold</th>
                  <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Returned</th>
                  <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Last sale</th>
                  <th style={{ textAlign: 'right', padding: '8px 18px', fontWeight: 600 }}>Watch</th>
                </tr></thead>
                <tbody>
                  {rk.slice(0, 25).map((x, i) => {
                    const X = S[x.it.id], pinned = d.pins.includes(x.it.id)
                    return (
                      <tr key={x.it.id} onClick={() => ui.openItem(x.it.id)} className="hov" style={{ borderTop: '1px solid var(--line)', cursor: 'pointer', background: ui.drawer?.kind === 'item' && ui.drawer.id === x.it.id ? 'var(--acc-soft)' : 'transparent' }}>
                        <td className="muted" style={{ padding: '10px 18px' }}>{i + 1}</td>
                        <td style={{ padding: '10px 8px' }}><div style={{ fontWeight: 600 }}>{x.it.tag}</div><div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: cc(x.it) }} />{d.catName(x.it.category_id)}</div></td>
                        <td style={{ padding: '10px 8px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontWeight: 700, minWidth: 28 }}>{x.n}</span><span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--sunk)', minWidth: 60 }}><span style={{ display: 'block', height: 8, borderRadius: 4, width: Math.round((x.n / mx) * 100) + '%', background: 'var(--acc)' }} /></span></div></td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{retBy[x.it.id] ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><MoveIcon type="ret" />{retBy[x.it.id]}</span> : <span className="muted">–</span>}</td>
                        <td className="muted" style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{X.last === null ? '—' : X.last === 0 ? 'Today' : fmtDay(agoDay(X.last, today), today)}</td>
                        <td style={{ padding: '6px 18px 6px 8px', textAlign: 'right' }}><button onClick={e => { e.stopPropagation(); ui.togglePin(x.it.id) }} title={pinned ? 'Unpin' : 'Pin to watch closely'} style={{ height: 32, padding: '0 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', ...pinBtn(pinned), background: pinned ? 'var(--acc)' : 'transparent' }}>{pinned ? 'Pinned' : 'Pin'}</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <aside className="card col side sticky" style={{ flex: '1 1 300px', padding: 18, gap: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Sales by category</div>
              <div className="muted" style={{ fontSize: 12, textWrap: 'pretty' }}>Share of pairs sold, against share of the stock on your shelves.</div>
            </div>
            {legend([['Sold', 1], ['In stock', 0.45]])}
            {catSales.map(c => (
              <div key={c.id} className="col" style={{ gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><b>{c.name}</b><span>{c.cs} pairs</span></div>
                {([[c.sp, 'var(--acc)', 1], [c.kp, 'var(--muted)', 0.45]] as const).map(([pct, bg, op], i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--sunk)' }}><span style={{ display: 'block', height: 8, borderRadius: 4, width: pct.toFixed(1) + '%', background: bg, opacity: op }} /></span>
                    <span className="muted" style={{ fontSize: 11, width: 32, textAlign: 'right' }}>{Math.round(pct)}%</span>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: c.vc, fontWeight: 600 }}>{c.verdict}</div>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </>
  )
}

function OneShoe({ it, byS, setTrendId, pinBtn }: { it: Item; byS: Item[]; setTrendId: (id: string) => void; pinBtn: (p: boolean) => object }) {
  const d = useData(), ui = useUi(), { S, st, today } = d
  const X = S[it.id], mo = X.mon, tot = mo.reduce((a, b) => a + b, 0), avg = tot / 12, mmx = Math.max(1, ...mo), bi = mo.indexOf(Math.max(...mo)), ch = trendOf(mo)
  const MN = (k: number) => monthName(k, today)
  const szMax = Math.max(1, ...X.sizes.map(z => Math.max(X.sz90[z] || 0, st(it.id, z))))
  const outSel = X.sizes.filter(z => st(it.id, z) <= 0 && (X.sz90[z] || 0) > 0)
  const insight = !tot ? 'No sales in the last 12 months. ' + X.total + ' pairs are on the shelf.'
    : 'Best month was ' + MN(bi) + ' with ' + mo[bi] + ' pairs. '
      + (ch === null ? '' : ch > 10 ? 'Sales are up ' + ch + '% on the 3 months before. ' : ch < -10 ? 'Sales are down ' + -ch + '% on the 3 months before. ' : 'Sales are steady. ')
      + (X.total <= 0 ? 'No stock left, so sales stop until you restock.' : X.wk > 0 ? 'At ' + f1(X.wk) + ' pairs a week, the ' + X.total + ' pairs left last ' + coverWords(X) + '.' : X.total + ' pairs on the shelf with no recent sales.')
      + (outSel.length ? ' Size' + (outSel.length > 1 ? 's ' : ' ') + outSel.join(', ') + (outSel.length > 1 ? ' are' : ' is') + ' sold out but still selling.' : '')
  const pinned = d.pins.includes(it.id)
  const stats = [
    { l: 'Sold, 12 months', v: n0(tot), s: 'pairs', c: 'var(--ink)' },
    { l: 'Monthly average', v: f1(avg), s: 'pairs a month', c: 'var(--ink)' },
    { l: 'Best month', v: MN(bi), s: mo[bi] + ' pairs', c: 'var(--ink)' },
    { l: 'Trend', v: trTxt(ch), s: 'last 3 full months', c: trCol(ch) },
    { l: 'In stock', v: String(X.total), s: X.coverTxt === 'Out' ? 'sold out' : X.coverTxt + ' left', c: coverCol(X) },
  ]
  return (
    <section id="one-shoe" className="card col" style={{ padding: 20, gap: 18, scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">One shoe · last 12 months</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 21, letterSpacing: '-.01em' }}>{it.tag}</h2>
          <div className="muted" style={{ fontSize: 13 }}>{it.colour} · {d.catName(it.category_id)} · {SYS[it.size_system].short} {it.size_from}–{it.size_to}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={() => ui.togglePin(it.id)} style={{ height: 42, padding: '0 16px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 200ms', ...pinBtn(pinned) }}>{pinned ? 'Pinned' : 'Pin this shoe'}</button>
          <label className="lbl">Choose a shoe
            <select className="inp" value={it.id} onChange={e => setTrendId(e.target.value)} style={{ height: 42, minWidth: 240, maxWidth: '100%', padding: '0 10px' }}>
              {byS.map(i => <option key={i.id} value={i.id}>{i.tag} · {S[i.id].s365} sold</option>)}
            </select>
          </label>
        </div>
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--acc-soft)', fontSize: 14, lineHeight: 1.5, textWrap: 'pretty' }}>{insight}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {stats.map(t => <div key={t.l} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--sunk)', minWidth: 0 }}><div className="eyebrow" style={{ fontSize: 11 }}>{t.l}</div><div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15, color: t.c }}>{t.v}</div><div className="muted" style={{ fontSize: 12 }}>{t.s}</div></div>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
        <div className="col" style={{ flex: '2 1 420px', minWidth: 0, gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Pairs sold per month</div>
            <div className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}><span style={{ width: 16, borderTop: '2px dashed var(--muted)' }} />monthly average · {f1(avg)} a month</div>
          </div>
          <div style={{ position: 'relative', height: 180, display: 'flex', alignItems: 'flex-end', gap: 6, borderBottom: '1px solid var(--line)' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: Math.round((avg / mmx) * 150), borderTop: '2px dashed var(--muted)', opacity: 0.6, pointerEvents: 'none' }} />
            {mo.map((v, k) => (
              <div key={k} title={MN(k) + (k === 11 ? ' (so far)' : '') + ': ' + v + ' pairs'} className="col" style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, minWidth: 0 }}>
                <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{v || ''}</span>
                <span style={{ width: '100%', maxWidth: 34, height: Math.round((v / mmx) * 150), minHeight: 2, borderRadius: '5px 5px 0 0', background: 'var(--acc)', opacity: k === 11 ? 0.5 : 1, transition: 'height 300ms' }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>{mo.map((_, k) => <span key={k} className="muted" style={{ flex: 1, textAlign: 'center', fontSize: 11, minWidth: 0 }}>{MN(k)}</span>)}</div>
          <div className="muted" style={{ fontSize: 11 }}>{MN(11)} is the current month, so its bar is lighter ({today.getDate()} days so far).</div>
        </div>
        <div className="col" style={{ flex: '1 1 260px', minWidth: 0, gap: 10 }}>
          <div><div style={{ fontSize: 14, fontWeight: 700 }}>Each size: sold vs on the shelf</div><div className="muted" style={{ fontSize: 12 }}>Sold in the last 3 months, against pairs in stock now.</div></div>
          <div className="muted" style={{ display: 'flex', gap: 14, fontSize: 11 }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 12, height: 7, borderRadius: 2, background: 'var(--acc)' }} />Sold, 3 months</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 12, height: 7, borderRadius: 2, background: 'var(--muted)', opacity: 0.45 }} />In stock</span>
          </div>
          {X.sizes.map(z => {
            const sd = X.sz90[z] || 0, v = st(it.id, z)
            return (
              <div key={z} title={'Size ' + z + ': ' + sd + ' sold in 3 months, ' + v + ' in stock'} style={{ display: 'grid', gridTemplateColumns: '30px minmax(0,1fr) 48px', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{z}</span>
                <span className="col" style={{ gap: 3 }}>
                  <span style={{ height: 7, borderRadius: 4, background: 'var(--acc)', width: Math.max(1, (sd / szMax) * 100) + '%' }} />
                  <span style={{ height: 7, borderRadius: 4, background: 'var(--muted)', opacity: 0.45, width: Math.max(1, (Math.max(0, v) / szMax) * 100) + '%' }} />
                </span>
                <span style={{ fontSize: 11, textAlign: 'right', lineHeight: 1.25 }}><b>{sd}</b> sold<br /><span style={{ color: v <= 0 ? 'var(--neg)' : v === 1 ? 'var(--warn)' : 'var(--muted)', fontWeight: 600 }}>{v <= 0 ? (v < 0 ? v + ' left' : 'none left') : v + ' left'}</span></span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
