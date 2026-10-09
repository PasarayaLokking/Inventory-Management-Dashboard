import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, errText } from './lib/supabase.ts'
import { DataProvider, useData } from './lib/data.tsx'
import { pal, catColor, type PageKey } from './lib/theme.ts'
import { alarmCheck, LBL, n0, plural, rg, type AlarmHit, type Item, type Line, type MoveType } from './lib/stats.ts'
import { UiContext, newLine, focusId, type Drawer, type EntryLine, type EntryMode, type Modal, type Page, type ToastKind, type Ui } from './ui.tsx'
import { Login } from './pages/Login.tsx'
import { Entry } from './pages/Entry.tsx'
import { Stock } from './pages/Stock.tsx'
import { Sales } from './pages/Sales.tsx'
import { ItemCard } from './drawers/ItemCard.tsx'
import { EditItem } from './drawers/EditItem.tsx'
import { Alarms } from './drawers/Alarms.tsx'

function applyPal(dark: boolean, k: PageKey) {
  const r = document.documentElement, T = pal(dark, k)
  for (const v in T) r.style.setProperty('--' + v, T[v])
  r.dataset.theme = dark ? 'dark' : 'light'
}
const storedDark = () => { try { return localStorage.getItem('theme') === 'dark' } catch { return false } }
const hashPage = (): Page => { const h = location.hash.slice(1); return h === 'stock' || h === 'sales' ? h : 'sale' }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [dark, setDarkState] = useState(storedDark)
  const setDark = (v: boolean) => { setDarkState(v); try { localStorage.setItem('theme', v ? 'dark' : 'light') } catch { /* private mode */ } }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  useLayoutEffect(() => { if (!session) applyPal(dark, 'sale') }, [session, dark])

  if (session === undefined) return null
  if (!session) return <Login />
  return <DataProvider key={session.user.id} userId={session.user.id}><Shell dark={dark} setDark={setDark} /></DataProvider>
}

type Toast = { id: number; msg: string; kind: ToastKind; undo?: () => void }
type Pop = { title: string; body: string; list: AlarmHit[] }

export function Shell({ dark, setDark }: { dark: boolean; setDark: (v: boolean) => void }) {
  const d = useData()
  const [w, setW] = useState(window.innerWidth)
  const narrow = w < 860
  const [page, setPage] = useState<Page>(hashPage)
  const [mode, setMode] = useState<EntryMode>('sale')
  const [lines, setLines] = useState<EntryLine[]>(() => [newLine()])
  const [drawer, setDrawer] = useState<Drawer | null>(null)
  const lastDrawer = useRef<Drawer | null>(null)
  if (drawer) lastDrawer.current = drawer
  const [modal, setModal] = useState<Modal | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [navCol, setNavCol] = useState(false)

  const isAdmin = d.isAdmin
  const cur: Page = isAdmin ? page : 'sale'

  // Supply and Return share the blue Stock in page; red stays on the Return badge only
  useLayoutEffect(() => applyPal(dark, cur === 'sale' ? (mode === 'sale' ? 'sale' : 'in') : cur), [dark, cur, mode])
  useEffect(() => {
    const r = () => setW(window.innerWidth), h = () => setPage(hashPage())
    window.addEventListener('resize', r); window.addEventListener('hashchange', h)
    return () => { window.removeEventListener('resize', r); window.removeEventListener('hashchange', h) }
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (pop) setPop(null); else if (modal) setModal(null); else if (drawer) setDrawer(null) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [pop, modal, drawer])

  const toast = useCallback((msg: string, kind: ToastKind = 'ok', undo?: () => void) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, kind, undo }].slice(-4))
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5500)
  }, [])

  const go = (p: Page) => {
    if (!isAdmin && p !== 'sale') return toast('That page needs an admin account', 'info')
    if (p !== cur) { location.hash = p === 'sale' ? '' : p; window.scrollTo(0, 0) }
    setPage(p); setDrawer(null)
  }

  const showAlarm = (list: AlarmHit[], title?: string, body?: string) => setPop({
    title: title ?? (list.length === 1 ? list[0].tag + ' size ' + list[0].size + (list[0].v <= 0 ? ' is sold out' : ' is running low') : list.length + ' sizes are running low'),
    body: body ?? 'This took them to or below your alarm level. Restock soon so you do not miss sales.',
    list,
  })

  async function undo(id: string, label: string) {
    const { error } = await supabase.rpc('void_movement', { p_id: id })
    if (error) return toast(errText(error), 'err')
    await d.reload()
    toast(label + ' undone · stock put back', 'info')
  }

  async function write(q: PromiseLike<{ error: unknown }>, okMsg?: string, undoFn?: () => void) {
    const { error } = await q
    if (error) { toast(errText(error), 'err'); return false }
    await d.reload()
    if (okMsg) toast(okMsg, 'ok', undoFn)
    return true
  }

  async function record(type: MoveType, date: string, note: string, ls: Line[], msg: string, alarmLines: Line[] = ls) {
    const hits = alarmCheck(alarmLines, d.items, d.cats, d.st) // against stock before this change
    const { data, error } = await supabase.rpc('record_movement', { p_type: type, p_date: date, p_note: note, p_lines: ls })
    if (error) { toast(errText(error), 'err'); return false }
    await d.reload()
    if (!data) { toast('Your counts match the stock card. Nothing to change.', 'info'); return true }
    if (hits.length) showAlarm(hits)
    toast(msg, 'ok', () => undo(data as string, type === 'sold' ? 'Sale' : LBL[type]))
    return true
  }

  function addToIn(list: { item_id: string; size: number }[]) {
    const seen = new Set<string>(), nls: EntryLine[] = []
    for (const x of list) {
      const k = x.item_id + '|' + x.size, it = d.byId(x.item_id)
      if (seen.has(k) || !it) continue
      seen.add(k); nls.push(newLine({ q: it.tag, it: it.id, size: String(x.size) }))
    }
    if (!nls.length) return
    setLines(ls => [...ls.filter(l => l.q || l.it), ...nls]); setMode('in'); go('sale'); setPop(null)
    focusId('lp' + nls[0].id)
    toast('Switched to Supply · ' + plural(nls.length, 'line') + ' added. Type the pairs received.', 'info')
  }

  function restockLine(it: Item) {
    const X = d.S[it.id], z = X.sizes.slice().sort((a, b) => (X.sz90[b] || 0) - (X.sz90[a] || 0))[0]
    const nl = newLine({ q: it.tag, it: it.id, size: String(z) })
    setLines(ls => [...ls.filter(l => l.q || l.it), nl]); setMode('in')
    focusId('lp' + nl.id)
    toast('Switched to Supply · ' + it.tag + ' added, size ' + z + ' sells most', 'info')
  }

  function startEntry(it: Item, m: EntryMode) {
    const nl = newLine({ q: it.tag, it: it.id })
    setLines(ls => [...ls.filter(l => l.q || l.it), nl]); setMode(m); go('sale')
    focusId('ls' + nl.id)
    toast((m === 'sale' ? 'New sale' : 'Supply') + ' · ' + it.tag + ' added. Pick the size, then type the pairs.', 'info')
  }

  function alarmNow(its: Item[], th: number) {
    const list = its.flatMap(it => rg(it.size_from, it.size_to).flatMap(z => { const v = d.st(it.id, z); return v <= th ? [{ item_id: it.id, tag: it.tag, size: z, v, th }] : [] }))
    if (list.length) showAlarm(list, 'Alarm on · ' + list.length + ' size' + (list.length > 1 ? 's are' : ' is') + ' already low', 'These sizes are at or below your alarm level right now.')
    else toast('Alarm on · you will get a pop-up when a size drops to the alarm level')
  }

  async function setItemAlarm(id: string, on: boolean | null, th: number, quiet?: boolean, why?: string) {
    const it = d.byId(id)!
    const patch = on === null ? { alarm_on: null, alarm_th: null, alarm_why: '' } : { alarm_on: on, alarm_th: th, ...(why !== undefined && { alarm_why: why }) }
    const { error } = await supabase.from('items').update(patch).eq('id', id)
    if (error) return toast(errText(error), 'err')
    await d.reload()
    if (quiet) return
    if (on === null) toast('Shoe alarm removed · ' + it.tag, 'info')
    else if (on) alarmNow([it], th)
    else toast('Alarm off · ' + it.tag, 'info')
  }

  async function setCatAlarm(id: string, on: boolean, th: number, quiet?: boolean) {
    const { error } = await supabase.from('categories').update({ alarm_on: on, alarm_th: th }).eq('id', id)
    if (error) return toast(errText(error), 'err')
    await d.reload()
    if (quiet) return
    if (on) alarmNow(d.live.filter(i => i.category_id === id && i.alarm_on === null), th)
    else toast('Alarm off · ' + d.catName(id), 'info')
  }

  async function togglePin(id: string) {
    if (!isAdmin) return
    const it = d.byId(id)!, pinned = d.pins.includes(id)
    if (!pinned && d.pins.length >= 6) return toast('You can pin up to 6 shoes. Unpin one first.', 'err')
    const { error } = pinned ? await supabase.from('pins').delete().eq('item_id', id).eq('user_id', d.me.id) : await supabase.from('pins').insert({ item_id: id })
    if (error) return toast(errText(error), 'err')
    d.setPins(pinned ? d.pins.filter(x => x !== id) : [...d.pins, id])
    toast(pinned ? 'Unpinned · ' + it.tag : 'Pinned · ' + it.tag + ' · now at the top of Sales and in the sidebar', pinned ? 'info' : 'ok')
  }

  async function confirmModal() {
    const m = modal
    if (!m) return
    if (m.kind === 'removeItem') {
      const it = d.byId(m.id)!
      const set = (removed_at: string | null) => write(supabase.from('items').update({ removed_at }).eq('id', m.id))
      setModal(null)
      if (await set(new Date().toISOString())) { setDrawer(null); toast(it.tag + ' removed · its past sales stay in reports', 'ok', () => set(null)) }
    } else {
      const moved = d.items.filter(i => i.category_id === m.id && !i.removed_at).length, name = d.catName(m.id)
      setModal(null)
      const a = await supabase.from('items').update({ category_id: m.to }).eq('category_id', m.id)
      const b = a.error ? a : await supabase.from('categories').delete().eq('id', m.id)
      await d.reload()
      if (b.error) return toast(errText(b.error), 'err')
      toast('Category "' + name + '" deleted' + (moved ? ' · ' + plural(moved, 'item') + ' moved to ' + d.catName(m.to) : ''))
    }
  }

  const ui: Ui = {
    dark, narrow, page: cur, go, mode, setMode, lines, setLines, drawer,
    openItem: id => { if (isAdmin) setDrawer({ kind: 'item', id }) },
    openEdit: (item, catId) => setDrawer({ kind: 'edit', item, catId }),
    openAlarms: () => setDrawer({ kind: 'alarms' }),
    closeDrawer: () => setDrawer(null),
    setModal, toast, record, undo, write, showAlarm, addToIn, restockLine, startEntry, setItemAlarm, setCatAlarm, togglePin,
  }

  // ── sidebar ──
  const totalPairs = d.live.reduce((a, i) => a + d.S[i.id].total, 0)
  const nav = ([['sale', mode === 'sale' ? 'New sale' : 'Stock in'], ['stock', 'Stock'], ['sales', 'Sales'], ['alarms', 'Low-stock alarms']] as const)
    .filter(([k]) => isAdmin || k === 'sale')
    .map(([k, label]) => {
      const isA = k === 'alarms', on = isA ? drawer?.kind === 'alarms' : cur === k
      return { k, label, on, go: isA ? ui.openAlarms : () => go(k), dot: 'var(--c-' + (k === 'sale' && mode !== 'sale' ? 'in' : k) + ')', badge: isA ? d.hits.length : 0 }
    })
  const full = narrow || !navCol, slim = !narrow && navCol
  const pinSide = isAdmin && !narrow && !navCol ? d.pins.map(d.byId).filter((i): i is Item => !!i && !i.removed_at) : []

  const dr = drawer ?? lastDrawer.current
  const cc = (i: Item) => catColor(d.cats.find(c => c.id === i.category_id)?.hue, dark).cc

  return (
    <UiContext.Provider value={ui}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: narrow ? 'column' : 'row', background: 'var(--bg)' }}>
        <aside style={{ flex: '0 0 auto', width: narrow ? '100%' : navCol ? 84 : 272, height: narrow ? 'auto' : '100vh', position: narrow ? 'relative' : 'sticky', top: 0, background: 'var(--surface)', borderRight: narrow ? 0 : '1px solid var(--line)', borderBottom: narrow ? '1px solid var(--line)' : 0, display: 'flex', flexDirection: narrow ? 'row' : 'column', flexWrap: narrow ? 'wrap' : 'nowrap', gap: narrow ? '10px 16px' : 24, padding: narrow ? '12px 16px' : navCol ? '20px 12px' : '22px 14px', zIndex: 5, transition: 'width 240ms ease, padding 240ms ease', overflowX: 'hidden', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, justifyContent: 'space-between', flexDirection: slim ? 'column' : 'row' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--acc)', color: 'var(--acc-ink)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18, flex: '0 0 auto' }}>S</div>
              {full && <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-.01em', lineHeight: 1.2 }}>Stock Management System</div><div className="muted" style={{ fontSize: 12, paddingTop: 2 }}>{d.live.length} items · {n0(totalPairs)} pairs</div></div>}
            </div>
            {!narrow && <button onClick={() => setNavCol(!navCol)} title={navCol ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={navCol ? 'Expand sidebar' : 'Collapse sidebar'} className="hov" style={{ width: 36, height: 36, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, flex: '0 0 auto', padding: 0 }}>{navCol ? '»' : '«'}</button>}
          </div>
          <nav style={{ display: 'flex', flexDirection: narrow ? 'row' : 'column', flexWrap: 'wrap', gap: 2 }}>
            {nav.map(n => (
              <button key={n.k} onClick={n.go} title={n.label} className="hov" style={{ whiteSpace: 'nowrap', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: slim ? 'center' : 'flex-start', gap: 12, height: 54, padding: slim ? 0 : '0 14px', border: 0, borderRadius: 12, background: n.on ? 'var(--acc-soft)' : 'transparent', color: 'var(--ink)', fontWeight: n.on ? 700 : 500, textAlign: 'left', cursor: 'pointer', fontSize: 17, transition: 'background 200ms' }}>
                <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 3, background: n.on ? 'var(--acc)' : 'transparent' }} />
                <span aria-hidden="true" style={{ width: 24, height: 24, background: n.dot, WebkitMask: `url(/assets/nav-${n.k}.png) center/contain no-repeat`, mask: `url(/assets/nav-${n.k}.png) center/contain no-repeat`, flex: '0 0 auto' }} />
                {full && <span style={{ flex: 1 }}>{n.label}</span>}
                {n.badge > 0 && <span style={{ minWidth: 22, height: 22, padding: '0 7px', borderRadius: 11, background: 'var(--neg)', color: '#fff', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{n.badge}</span>}
              </button>
            ))}
          </nav>
          {pinSide.length > 0 && (
            <div className="col" style={{ gap: 2, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <div className="eyebrow" style={{ fontWeight: 700, padding: '10px 14px 6px' }}>Pinned shoes</div>
              {pinSide.map(it => {
                const X = d.S[it.id], low = X.sizes.some(z => d.st(it.id, z) <= 1 && (X.sz90[z] || 0) > 0)
                return (
                  <button key={it.id} onClick={() => ui.openItem(it.id)} title={it.tag} className="hov" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '6px 14px', border: 0, borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: cc(it), flex: '0 0 auto' }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="ell" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{it.tag}</span>
                      <span style={{ display: 'block', fontSize: 12, color: X.total <= 0 || low ? 'var(--warn)' : 'var(--muted)' }}>{X.weekly[7]} sold this week · {X.total} left</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="col" style={{ marginTop: narrow ? 0 : 'auto', gap: 12, marginLeft: narrow ? 'auto' : 0 }}>
            <div style={{ display: 'flex', flexDirection: slim ? 'column' : 'row', padding: 3, gap: 3, background: 'var(--sunk)', borderRadius: 10 }}>
              <button onClick={() => setDark(false)} style={{ flex: 1, height: 32, padding: '0 10px', border: 0, borderRadius: 8, background: dark ? 'transparent' : 'var(--surface)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Light</button>
              <button onClick={() => setDark(true)} style={{ flex: 1, height: 32, padding: '0 10px', border: 0, borderRadius: 8, background: dark ? 'var(--surface)' : 'transparent', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Dark</button>
            </div>
            {!slim && (
              <div className="muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                <span>Signed in as <b style={{ color: 'var(--ink)' }}>{d.me.display_name}</b> · {isAdmin ? 'Admin' : 'Staff'}</span>
                <a onClick={() => supabase.auth.signOut()}>Sign out</a>
              </div>
            )}
          </div>
        </aside>

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {isAdmin && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: narrow ? '9px 16px' : '9px 32px', background: 'var(--ink)', color: 'var(--surface)', fontSize: 13 }}>
              <span style={{ padding: '3px 9px', borderRadius: 6, background: 'var(--surface)', color: 'var(--ink)', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>ADMIN MODE</span>
              <span style={{ flex: 1, minWidth: 0 }}>Full access · stock, items, categories, alarms and insights can all be changed.</span>
              <a onClick={() => supabase.auth.signOut()} style={{ color: 'var(--surface)' }}>Sign out</a>
            </div>
          )}
          {cur === 'sale' && <Entry />}
          {cur === 'stock' && <Stock />}
          {cur === 'sales' && <Sales />}
        </main>

        {/* drawer */}
        <div onClick={() => setDrawer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(12,14,18,.34)', opacity: drawer ? 1 : 0, pointerEvents: drawer ? 'auto' : 'none', transition: 'opacity 220ms ease', zIndex: 40 }} />
        <aside role="dialog" aria-label={dr?.kind === 'alarms' ? 'Low-stock alarms' : 'Item card'} inert={!drawer} style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: narrow ? '100vw' : 600, maxWidth: '100vw', background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: drawer ? '-24px 0 60px rgba(0,0,0,.18)' : 'none', transform: drawer ? 'translateX(0)' : 'translateX(calc(100% + 80px))', transition: 'transform 280ms cubic-bezier(.2,.8,.2,1)', zIndex: 41, display: 'flex', flexDirection: 'column' }}>
          {dr?.kind === 'item' && <ItemCard key={dr.id} id={dr.id} />}
          {dr?.kind === 'edit' && <EditItem key={dr.item?.id ?? 'new'} item={dr.item} catId={dr.catId} />}
          {dr?.kind === 'alarms' && <Alarms />}
        </aside>

        {modal && <ConfirmModal modal={modal} setModal={setModal} onConfirm={confirmModal} />}

        {pop && (
          <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(12,14,18,.5)', zIndex: 65, display: 'grid', placeItems: 'center', padding: 20 }}>
            <div role="alertdialog" aria-label="Low-stock alarm" onClick={e => e.stopPropagation()} style={{ width: 'min(480px,100%)', background: 'var(--surface)', borderRadius: 18, boxShadow: '0 30px 80px rgba(0,0,0,.35)', overflow: 'hidden', animation: 'toastIn 200ms ease' }}>
              <div style={{ padding: '20px 22px', background: dark ? 'oklch(0.45 0.17 27)' : 'oklch(0.53 0.2 27)', color: '#fff', display: 'flex', gap: 14, alignItems: 'center' }}>
                <span style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,.2)', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 700, flex: '0 0 auto' }}>!</span>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 700 }}>Low-stock alarm</div><h2 style={{ margin: '2px 0 0', fontSize: 20, lineHeight: 1.2 }}>{pop.title}</h2></div>
              </div>
              <div className="col" style={{ padding: '16px 22px 8px', maxHeight: '50vh', overflow: 'auto' }}>
                <p className="muted" style={{ margin: '0 0 10px', fontSize: 14, textWrap: 'pretty' }}>{pop.body}{pop.list.length > 12 ? ' Showing 12 of ' + pop.list.length + '.' : ''}</p>
                {pop.list.slice(0, 12).map(a => (
                  <div key={a.item_id + a.size} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14 }}>{a.tag}</div><div className="muted" style={{ fontSize: 12 }}>Size {a.size} · alarm at {a.th === 0 ? '0' : a.th + ' or less'}</div></div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: a.v <= 0 ? 'var(--neg)' : 'var(--warn)', whiteSpace: 'nowrap' }}>{a.v <= 0 ? (a.v < 0 ? a.v + ' left' : 'Sold out') : a.v + ' left'}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setPop(null)} style={{ height: 44, padding: '0 16px' }}>OK, got it</button>
                <button className="btn hov-bright" onClick={() => addToIn(pop.list)} style={{ height: 44, padding: '0 18px', border: 0, background: 'var(--ink)', color: 'var(--bg)', fontWeight: 700 }}>Add these to Stock in</button>
              </div>
            </div>
          </div>
        )}

        <div aria-live="polite" style={{ position: 'fixed', bottom: 20, right: 20, left: narrow ? 20 : 'auto', zIndex: 70, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', pointerEvents: 'none' }}>
          {toasts.map(t => (
            <div key={t.id} style={{ pointerEvents: 'auto', display: 'flex', gap: 12, alignItems: 'center', maxWidth: 440, padding: '12px 14px 12px 16px', borderRadius: 12, background: 'var(--ink)', color: 'var(--bg)', boxShadow: '0 14px 40px rgba(0,0,0,.25)', animation: 'toastIn 200ms ease', fontSize: 14 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.kind === 'err' || t.kind === 'warn' ? 'oklch(0.68 0.19 27)' : t.kind === 'info' ? 'oklch(0.75 0.02 260)' : 'var(--acc)', flex: '0 0 auto' }} />
              <span style={{ flex: 1, textWrap: 'pretty' }}>{t.msg}</span>
              {t.undo && <button onClick={() => { t.undo!(); setToasts(x => x.filter(y => y.id !== t.id)) }} style={{ whiteSpace: 'nowrap', flexShrink: 0, height: 30, padding: '0 10px', border: '1px solid currentColor', borderRadius: 8, background: 'transparent', color: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Undo</button>}
              <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} aria-label="Dismiss" style={{ flexShrink: 0, width: 26, height: 26, border: 0, background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </UiContext.Provider>
  )
}

function ConfirmModal({ modal: m, setModal, onConfirm }: { modal: Modal; setModal: (m: Modal | null) => void; onConfirm: () => void }) {
  const d = useData()
  let title = '', body = '', label = '', moveOpts = null as null | { id: string; name: string }[]
  if (m.kind === 'removeItem') {
    title = 'Remove ' + (d.byId(m.id)?.tag ?? 'item') + '?'
    body = 'It will disappear from the stock list and the sale form. Its past sales and deliveries stay in your reports. You can undo straight after.'
    label = 'Remove item'
  } else {
    const c = d.cats.find(x => x.id === m.id), n = d.live.filter(i => i.category_id === m.id).length
    title = 'Delete "' + (c?.name ?? '') + '"?'
    body = n ? 'This category has ' + plural(n, 'item') + '. Choose where to move ' + (n > 1 ? 'them' : 'it') + '. No sales or stock are lost.' : 'This category is empty. Nothing else changes.'
    label = 'Delete category'
    if (n) moveOpts = d.cats.filter(x => x.id !== m.id)
  }
  return (
    <div onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(12,14,18,.45)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div role="alertdialog" aria-label={title} onClick={e => e.stopPropagation()} className="card col" style={{ width: 'min(440px,100%)', boxShadow: '0 30px 80px rgba(0,0,0,.3)', padding: 22, gap: 14, animation: 'toastIn 180ms ease' }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>{title}</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14, textWrap: 'pretty' }}>{body}</p>
        {moveOpts && m.kind === 'delCat' && (
          <label className="lbl">Move its items to
            <select className="inp" value={m.to} onChange={e => setModal({ ...m, to: e.target.value })} style={{ padding: '0 10px' }}>
              {moveOpts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button className="btn" onClick={() => setModal(null)} style={{ height: 42 }}>Keep it</button>
          <button className="btn btn-neg" onClick={onConfirm} style={{ height: 42, padding: '0 16px' }} autoFocus>{label}</button>
        </div>
      </div>
    </div>
  )
}
