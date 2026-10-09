import { useEffect, useState, type CSSProperties } from 'react'
import { useData } from '../lib/data.tsx'
import { supabase } from '../lib/supabase.ts'
import { catColor } from '../lib/theme.ts'
import { HUES, LBL, SYS, f1, inSum, isoDay, n0, plural, rg, search, toCsv, type Item, type Sys } from '../lib/stats.ts'
import { useUi, PageHeader, MoveIcon, download } from '../ui.tsx'

const HATCH = 'repeating-linear-gradient(135deg,var(--line) 0 1px,transparent 1px 6px)'

export function Stock() {
  const d = useData(), ui = useUi(), { S } = d
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [sort, setSort] = useState<'name' | 'stock' | 'best' | 'cover'>('name')
  const [hide, setHide] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newHue, setNewHue] = useState<number | null>(null)
  const [catEdit, setCatEdit] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && !/input|select|textarea/i.test((document.activeElement as HTMLElement)?.tagName)) { e.preventDefault(); document.getElementById('stock-search')?.focus() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const cc = (catId: string) => catColor(d.cats.find(c => c.id === catId)?.hue, ui.dark)
  const coverKey = (i: Item) => (S[i.id].total <= 0 ? -1 : S[i.id].cover ?? 999)
  const sorters = { name: (a: Item, b: Item) => a.tag.localeCompare(b.tag), stock: (a: Item, b: Item) => S[b.id].total - S[a.id].total, best: (a: Item, b: Item) => S[b.id].s30 - S[a.id].s30, cover: (a: Item, b: Item) => coverKey(a) - coverKey(b) }
  let sq = search(q, d.live, d.catName).filter(it => (cat === 'all' || it.category_id === cat) && (!hide || S[it.id].total > 0))
  if (!q.trim() || sort !== 'name') sq = sq.sort(sorters[sort])
  const filtering = !!q.trim() || hide
  const openId = ui.drawer?.kind === 'item' ? ui.drawer.id : null
  const in30 = { in: inSum(d.ins, 'in', 30, d.today), ret: inSum(d.ins, 'ret', 30, d.today) }

  // ── category actions ──
  const nextHue = HUES.find(h => !d.cats.some(c => c.hue === h)) ?? HUES[0]
  const selHue = newHue ?? nextHue
  async function addCat() {
    const n = newCat.trim()
    if (!n) return ui.toast('Type a name for the new category first.', 'err')
    if (d.cats.some(c => c.name.toLowerCase() === n.toLowerCase())) return ui.toast('There is already a category called "' + n + '".', 'err')
    if (await ui.write(supabase.from('categories').insert({ name: n, hue: selHue, sort_order: d.cats.length }), 'Category added · ' + n + ' · low-stock alarm off')) { setNewCat(''); setNewHue(null); setAddOpen(false) }
  }
  async function moveCat(i: number, dir: number) {
    const c = d.cats.slice(), j = i + dir
    if (j < 0 || j >= c.length) return
    ;[c[i], c[j]] = [c[j], c[i]]
    const changed = c.map((x, k) => ({ x, k })).filter(({ x, k }) => x.sort_order !== k)
    await ui.write(Promise.all(changed.map(({ x, k }) => supabase.from('categories').update({ sort_order: k }).eq('id', x.id))).then(rs => ({ error: rs.find(r => r.error)?.error ?? null })))
  }
  const cycleCat = (id: string, hue: number | null) => ui.write(supabase.from('categories').update({ hue: HUES[((hue == null ? -1 : HUES.indexOf(hue)) + 1) % HUES.length] }).eq('id', id))
  async function commitCat() {
    const ce = catEdit
    setCatEdit(null)
    const c = ce && d.cats.find(x => x.id === ce.id), n = ce?.name.trim()
    if (ce && c && n && n !== c.name) await ui.write(supabase.from('categories').update({ name: n }).eq('id', ce.id), 'Category renamed · ' + n)
  }
  function delCat(id: string) {
    const other = d.cats.find(x => x.id !== id)
    if (!other) return ui.toast('Keep at least one category.', 'err')
    ui.setModal({ kind: 'delCat', id, to: (d.cats.find(x => x.name === 'Uncategorised' && x.id !== id) ?? other).id })
  }

  function csvStock() {
    const rows: unknown[][] = [['Item', 'Code', 'Colour', 'Brand', 'Details', 'Category', 'Size system', 'Size', 'Pairs in stock']]
    d.live.forEach(i => rg(i.size_from, i.size_to).forEach(z => rows.push([i.tag, i.code, i.colour, i.brand, i.details, d.catName(i.category_id), SYS[i.size_system].short, z, d.st(i.id, z)])))
    download('stock-list-' + isoDay() + '.csv', toCsv(rows))
    ui.toast('Downloaded stock list', 'info')
  }

  const removed = d.items.filter(i => i.removed_at)
  const slowPairs = d.slow.reduce((a, i) => a + S[i.id].total, 0)
  const legend = (box: CSSProperties, txt: string, label: string) => <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 26, height: 20, borderRadius: 4, display: 'grid', placeItems: 'center', ...box }}>{txt}</span>{label}</span>
  const sel = { height: 40, padding: '0 10px', background: 'var(--surface)' }

  return (
    <>
      <PageHeader eyebrow="Look up" title="Stock" sub="Pairs left by size, grouped by category. Add, rename or remove items and categories right here."
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-acc" onClick={() => ui.openEdit(null, cat !== 'all' ? cat : undefined)} style={{ height: 44, padding: '0 18px', fontSize: 15 }}>+ Add item</button>
            <button className="btn" onClick={() => setAddOpen(!addOpen)} style={{ height: 44, padding: '0 18px', fontSize: 15, fontWeight: 700, borderColor: 'var(--acc-line)', background: 'var(--surface)' }}>+ Add category</button>
            <button className="btn" onClick={csvStock} style={{ height: 44, padding: '0 16px', background: 'var(--surface)' }}>Download CSV</button>
          </div>
        }
        below={<input id="stock-search" className="inp" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && sq[0]) ui.openItem(sq[0].id) }} placeholder="Search tag, code, colour, brand… (press / to jump here)" aria-label="Search stock" style={{ marginTop: 18, width: '100%', height: 56, padding: '0 18px', borderColor: 'var(--acc-line)', borderRadius: 14, background: 'var(--surface)', fontSize: 18 }} />} />
      <div className="page-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div className="col" style={{ flex: '1 1 600px', minWidth: 0, gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <select className="inp" value={cat} onChange={e => setCat(e.target.value)} aria-label="Category" style={sel}>
              <option value="all">All categories</option>
              {d.cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="inp" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort" style={sel}>
              <option value="name">Sort: item name</option>
              <option value="stock">Sort: most stock</option>
              <option value="best">Sort: best selling (30 days)</option>
              <option value="cover">Sort: running out first</option>
            </select>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}><input type="checkbox" checked={hide} onChange={e => setHide(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--acc)' }} />Hide items with no stock</label>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{sq.length} of {d.live.length} items</span>
          </div>
          <div className="muted" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, alignItems: 'center' }}>
            {legend({ border: '1px solid var(--line)', color: 'var(--ink)', fontWeight: 600 }, '7', 'pairs left')}
            {legend({ background: 'var(--warn-soft)', color: 'var(--warn)', fontWeight: 700 }, '1', 'last pair')}
            {legend({ border: '1px solid var(--line)' }, '–', 'none left')}
            {legend({ background: 'var(--neg-soft)', color: 'var(--neg)', fontWeight: 700 }, '-2', 'below zero, needs checking')}
            {legend({ background: 'repeating-linear-gradient(135deg,var(--line) 0 1px,transparent 1px 5px)' }, '', 'size not stocked')}
            {(['in', 'ret'] as const).map(k => <span key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><MoveIcon type={k} />{LBL[k]}, last 30 days</span>)}
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ width: 4, height: 20, borderRadius: 2, background: 'var(--muted)' }} />left edge = category colour</span>
          </div>

          {addOpen && (
            <section className="card" style={{ padding: 18, borderColor: 'var(--acc-line)', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', animation: 'toastIn 180ms ease' }}>
              <label className="col" style={{ flex: '1 1 240px', gap: 6, fontSize: 13, fontWeight: 700 }}>New category name
                <input className="inp" autoFocus value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCat() }} placeholder="e.g. Sandals" style={{ height: 48, fontSize: 16 }} />
              </label>
              <div className="col" style={{ gap: 8 }}><span style={{ fontSize: 13, fontWeight: 700 }}>Colour</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 48 }}>
                  {HUES.map(h => { const c = catColor(h, ui.dark).cc; return <button key={h} onClick={() => setNewHue(h)} aria-label="Pick colour" aria-pressed={h === selHue} style={{ width: 30, height: 30, borderRadius: '50%', border: 0, padding: 0, background: c, boxShadow: h === selHue ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : 'none', cursor: 'pointer', transition: 'box-shadow 150ms' }} /> })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setAddOpen(false)} style={{ height: 48, padding: '0 16px' }}>Cancel</button>
                <button className="btn btn-acc" onClick={addCat} style={{ height: 48, padding: '0 20px', fontSize: 15 }}>Add category</button>
              </div>
              <div className="muted" style={{ flexBasis: '100%', fontSize: 12 }}>New categories start with the low-stock alarm off.</div>
            </section>
          )}

          {!sq.length && filtering && (
            <div className="col" style={{ padding: '40px 24px', border: '1px dashed var(--line)', borderRadius: 16, textAlign: 'center', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>No item matches “{q}”</div>
              <div className="muted" style={{ fontSize: 14 }}>Check the spelling, try the model number only, or <a onClick={() => ui.openEdit(null)}>add a new item</a>.</div>
            </div>
          )}

          {d.cats.map((c, ci) => {
            if (cat !== 'all' && c.id !== cat) return null
            const rows = sq.filter(i => i.category_id === c.id)
            if (!rows.length && filtering) return null
            const col = cc(c.id), pairs = rows.reduce((a, i) => a + S[i.id].total, 0), editing = catEdit?.id === c.id
            const tables = (['UK', 'CAP', 'EU'] as Sys[]).flatMap(k => { const rr = rows.filter(x => x.size_system === k); return rr.length ? [{ k, rows: rr, sizes: rg(Math.min(...rr.map(x => x.size_from)), Math.max(...rr.map(x => x.size_to))) }] : [] })
            return (
              <section key={c.id} className="card" style={{ borderTop: '5px solid ' + col.cc, overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: col.cs, borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 260px' }}>
                    <button onClick={() => cycleCat(c.id, c.hue)} title="Change colour" aria-label="Change category colour" style={{ width: 32, height: 32, border: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flex: '0 0 auto' }}><span style={{ width: 18, height: 18, borderRadius: '50%', background: col.cc, boxShadow: '0 0 0 3px var(--surface)' }} /></button>
                    {editing
                      ? <input autoFocus value={catEdit.name} onChange={e => setCatEdit({ id: c.id, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') commitCat(); if (e.key === 'Escape') setCatEdit(null) }} onBlur={commitCat} aria-label="Category name" style={{ flex: 1, minWidth: 0, height: 42, padding: '0 10px', border: '1px solid var(--acc)', borderRadius: 10, background: 'var(--bg)', fontSize: 18, fontWeight: 700, outline: 'none', boxShadow: '0 0 0 3px var(--acc-soft)' }} />
                      : <div style={{ minWidth: 0 }}><h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-.01em' }}>{c.name}</h2><div className="muted" style={{ fontSize: 13 }}>{plural(rows.length, 'item')} · {n0(pairs)} pairs</div></div>}
                  </div>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn" onClick={() => ui.openEdit(null, c.id)} style={{ height: 38, marginRight: 6, fontWeight: 700, background: 'var(--surface)' }}>+ Add item here</button>
                    <button className="icon-btn" onClick={() => moveCat(ci, -1)} title="Move category up" aria-label="Move category up">↑</button>
                    <button className="icon-btn" onClick={() => moveCat(ci, 1)} title="Move category down" aria-label="Move category down">↓</button>
                    <button className="icon-btn" onClick={() => setCatEdit({ id: c.id, name: c.name })} title="Rename category" aria-label="Rename category">✎</button>
                    <button className="icon-btn hov-neg" onClick={() => delCat(c.id)} title="Delete category" aria-label="Delete category" style={{ fontSize: 19 }}>×</button>
                  </div>
                </div>
                {!rows.length && <div className="muted" style={{ padding: 18, fontSize: 14 }}>No items in this category yet. Use “+ Add item here”.</div>}
                {tables.map(t => (
                  <div key={t.k}>
                    {tables.length > 1 && <div className="muted" style={{ padding: '12px 18px 2px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{SYS[t.k].label}</div>}
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 14 }}>
                        <thead>
                          <tr className="muted" style={{ fontSize: 12 }}>
                            <th style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--sunk)', textAlign: 'left', padding: '8px 14px', fontWeight: 600, minWidth: 210, borderBottom: '1px solid var(--line)' }}>Item</th>
                            {t.sizes.map(z => <th key={z} style={{ background: 'var(--sunk)', padding: '8px 0', minWidth: 40, fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{z}</th>)}
                            <th style={{ background: 'var(--sunk)', padding: '8px 10px', color: 'var(--ink)', fontWeight: 700, borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)' }}>Total</th>
                            <th style={{ background: 'var(--sunk)', padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>Sold 30d</th>
                            <th style={{ background: 'var(--sunk)', padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>In 30d</th>
                            <th style={{ background: 'var(--sunk)', borderBottom: '1px solid var(--line)', padding: '8px 14px' }} />
                          </tr>
                        </thead>
                        <tbody>
                          {t.rows.map(it => {
                            const X = S[it.id], on = openId === it.id
                            return (
                              <tr key={it.id} onClick={() => ui.openItem(it.id)} className="hov" style={{ cursor: 'pointer', background: on ? 'var(--acc-soft)' : 'transparent' }}>
                                <td style={{ position: 'sticky', left: 0, background: on ? 'var(--acc-soft)' : 'var(--surface)', padding: '8px 14px', borderBottom: '1px solid var(--line)', boxShadow: 'inset 4px 0 0 ' + (on ? 'var(--acc)' : col.cc) }}>
                                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{it.tag}</div>
                                  <div className="muted ell" style={{ fontSize: 12, maxWidth: 240 }}>{it.colour} · {it.details}</div>
                                </td>
                                {t.sizes.map(z => {
                                  if (z < it.size_from || z > it.size_to) return <td key={z} title={'Size ' + z + ' not stocked'} style={{ padding: 0, borderBottom: '1px solid var(--line)', background: HATCH }} />
                                  const v = d.st(it.id, z)
                                  const [bg, color, fw, title] = v < 0 ? ['var(--neg-soft)', 'var(--neg)', 700, 'below zero, needs checking'] : v === 0 ? ['transparent', 'var(--muted)', 400, 'none left'] : v === 1 ? ['var(--warn-soft)', 'var(--warn)', 700, 'last pair'] : ['transparent', 'var(--ink)', 500, v + ' pairs']
                                  return <td key={z} title={'Size ' + z + ': ' + title} style={{ textAlign: 'center', padding: 0, borderBottom: '1px solid var(--line)', background: bg, color, fontWeight: fw }}>{v === 0 ? '–' : v}</td>
                                })}
                                <td style={{ textAlign: 'center', padding: '0 10px', borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)', fontWeight: 700, fontSize: 15, color: X.total < 0 ? 'var(--neg)' : 'var(--ink)' }}>{X.total}</td>
                                <td className="muted" style={{ textAlign: 'center', padding: '0 10px', borderBottom: '1px solid var(--line)' }}>{X.s30 || '–'}</td>
                                <td style={{ textAlign: 'center', padding: '0 10px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                                  {in30.in[it.id] || in30.ret[it.id]
                                    ? <span style={{ display: 'inline-flex', gap: 10 }}>{(['in', 'ret'] as const).filter(k => in30[k][it.id]).map(k => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><MoveIcon type={k} />{in30[k][it.id]}</span>)}</span>
                                    : <span className="muted">–</span>}
                                </td>
                                <td style={{ padding: '0 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                                  <button onClick={e => { e.stopPropagation(); ui.setModal({ kind: 'removeItem', id: it.id }) }} title="Remove this item from the system" className="btn hov-neg" style={{ height: 32, padding: '0 10px', borderRadius: 8, color: 'var(--muted)', fontSize: 12 }}>Remove</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            )
          })}

          {removed.length > 0 && (
            <section className="col" style={{ padding: '16px 18px', border: '1px dashed var(--line)', borderRadius: 16, gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><h2 style={{ margin: 0, fontSize: 16 }}>Removed items</h2><span className="muted" style={{ fontSize: 12 }}>Hidden from stock and the sale form. Past sales stay in reports.</span></div>
              {removed.map(i => (
                <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: cc(i.category_id).cc }} />
                  <span className="muted" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{i.tag} <span style={{ fontWeight: 400 }}>· {d.catName(i.category_id)}</span></span>
                  <button className="btn" onClick={() => ui.write(supabase.from('items').update({ removed_at: null }).eq('id', i.id), 'Restored · ' + i.tag)} style={{ height: 32, padding: '0 12px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>Restore</button>
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="side sticky">
          <section className="card col" style={{ padding: 18, gap: 14 }}>
            <div>
              <div className="eyebrow">Stock health</div>
              <div className="muted" style={{ fontSize: 13, paddingTop: 4, textWrap: 'pretty' }}>How your stock compares with what is selling. Click an item to open its card.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              <div style={{ padding: 10, borderRadius: 10, background: 'var(--warn-soft)' }}><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--warn)' }}>{d.restock.length}</div><div style={{ fontSize: 11 }}>running low</div></div>
              <div style={{ padding: 10, borderRadius: 10, background: 'var(--sunk)' }}><div style={{ fontSize: 22, fontWeight: 700 }}>{d.gaps.length}</div><div style={{ fontSize: 11 }}>selling sizes out</div></div>
              <div style={{ padding: 10, borderRadius: 10, background: 'var(--acc-soft)' }}><div style={{ fontSize: 22, fontWeight: 700, color: 'var(--acc-text)' }}>{n0(slowPairs)}</div><div style={{ fontSize: 11 }}>pairs not moving</div></div>
            </div>
          </section>
          <HealthList title="Running low" rows={d.restock.slice(0, 6).map(i => ({ id: i.id, tag: i.tag, sub: S[i.id].total + ' left · sells ' + f1(S[i.id].wk) + ' a week', right: S[i.id].coverTxt }))} />
          <HealthList title="Sizes that sell, but none left" rows={d.gaps.slice(0, 6).map(g => ({ id: g.it.id, tag: g.it.tag + ' · size ' + g.size, sub: g.n + ' sold in 3 months, none left' }))} />
          <HealthList title="Not moving" note="Lots of stock, few or no sales in 3 months." rows={d.slow.slice(0, 5).map(i => ({ id: i.id, tag: i.tag, sub: S[i.id].total + ' pairs · ' + (S[i.id].s90 === 0 ? 'no sales in 3 months' : 'sells ' + f1(S[i.id].wk) + ' a week') }))} />
        </aside>
      </div>
    </>
  )
}

function HealthList({ title, note, rows }: { title: string; note?: string; rows: { id: string; tag: string; sub: string; right?: string }[] }) {
  const ui = useUi()
  return (
    <section className="card col" style={{ padding: 18, gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
      {note && <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>{note}</div>}
      {!rows.length && <div className="muted" style={{ fontSize: 13 }}>Nothing here right now.</div>}
      {rows.map((r, k) => (
        <button key={r.id + k} onClick={() => ui.openItem(r.id)} className="row-btn hov-acc" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0' }}>
          <span style={{ minWidth: 0 }}><b style={{ fontSize: 13 }}>{r.tag}</b><br /><span className="muted" style={{ fontSize: 12 }}>{r.sub}</span></span>
          {r.right && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)', whiteSpace: 'nowrap' }}>{r.right}</span>}
        </button>
      ))}
    </section>
  )
}
