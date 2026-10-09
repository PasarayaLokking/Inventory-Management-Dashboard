import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase, fetchAll, errText } from './supabase.ts'
import { alarmTh, buildStats, isoDay, rg, type Category, type InDay, type Item, type ItemStat, type Movement, type Profile, type SoldDay, type SoldMonth, type StockFn } from './stats.ts'

export type Raw = { profiles: Profile[]; cats: Category[]; items: Item[]; stock: { item_id: string; size: number; qty: number }[]; daily: SoldDay[]; monthly: SoldMonth[]; ins: InDay[]; recent: Movement[]; pins: string[] }

async function load(userId: string): Promise<Raw> {
  const now = new Date(), today = isoDay(now), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const recent = supabase.from('movements').select('id,type,occurred_on,note,created_by,created_at,movement_lines(item_id,size,qty)')
    .is('voided_at', null).or(`occurred_on.gte.${today},created_at.gte.${start}`).order('created_at', { ascending: false })
  const pins = supabase.from('pins').select('item_id').eq('user_id', userId)
  const [profiles, cats, items, stock, daily, monthly, ins, r, p] = await Promise.all([
    fetchAll<Profile>('profiles', '*', ['id']),
    fetchAll<Category>('categories', '*', ['sort_order', 'name']),
    fetchAll<Item>('items', '*', ['tag']),
    fetchAll<Raw['stock'][number]>('stock', 'item_id,size,qty', ['item_id', 'size']),
    fetchAll<SoldDay>('sold_daily', '*', ['day', 'item_id', 'size']),
    fetchAll<SoldMonth>('sold_monthly', '*', ['month', 'item_id']),
    fetchAll<InDay>('in_daily', '*', ['day', 'item_id', 'size', 'type']),
    recent, pins,
  ])
  if (r.error) throw r.error
  if (p.error) throw p.error
  return { profiles, cats, items, stock, daily, monthly, ins, recent: r.data as Movement[], pins: p.data.map(x => x.item_id as string) }
}

export function derive(raw: Raw, userId: string) {
  const today = new Date()
  const stockMap = new Map(raw.stock.map(r => [r.item_id + '|' + r.size, r.qty]))
  const st: StockFn = (id, z) => stockMap.get(id + '|' + z) ?? 0
  const itemMap = new Map(raw.items.map(i => [i.id, i]))
  const live = raw.items.filter(i => !i.removed_at)
  const S: Record<string, ItemStat> = buildStats(raw.items, st, raw.daily, raw.monthly, today)
  const catName = (id: string) => raw.cats.find(c => c.id === id)?.name ?? 'Uncategorised'
  const people = Object.fromEntries(raw.profiles.map(p => [p.id, p]))
  const me: Profile = people[userId] ?? { id: userId, username: '', display_name: 'User', role: 'staff' }

  // alarms ringing now: every live shoe with an alarm and at least one size at or below its level
  const hits = live.flatMap(it => {
    const th = alarmTh(it, raw.cats); if (th === null) return []
    const low = rg(it.size_from, it.size_to).filter(z => st(it.id, z) <= th)
    return low.length ? [{ it, th, low }] : []
  })
  // stock health (design: restockAll / gaps / slowAll)
  const restock = live.filter(i => S[i.id].s90 > 0 && S[i.id].cover !== null && S[i.id].cover! < 4).sort((a, b) => S[a.id].cover! - S[b.id].cover!)
  const gaps = live.flatMap(i => S[i.id].sizes.flatMap(z => { const n = S[i.id].sz90[z] || 0; return st(i.id, z) <= 0 && n >= 3 ? [{ it: i, size: z, n }] : [] })).sort((a, b) => b.n - a.n)
  const slow = live.filter(i => S[i.id].total >= 10 && (S[i.id].s90 === 0 || S[i.id].cover! > 30)).sort((a, b) => S[b.id].total - S[a.id].total)

  return { ...raw, today, st, S, live, byId: (id: string) => itemMap.get(id), catName, people, me, isAdmin: me.role === 'admin', hits, restock, gaps, slow }
}

export type Data = ReturnType<typeof derive> & { reload: () => Promise<void>; setPins: (ids: string[]) => void }
export const DataContext = createContext<Data>(null!)
export const useData = () => useContext(DataContext)

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [raw, setRaw] = useState<Raw | null>(null)
  const [error, setError] = useState('')
  const busy = useRef<Promise<void> | null>(null)

  const reload = useCallback(async () => {
    // one load at a time; a change during a load triggers one more
    if (busy.current) { await busy.current; return reload() }
    busy.current = load(userId).then(r => { setRaw(r); setError('') }, e => setError(errText(e))).finally(() => { busy.current = null })
    return busy.current
  }, [userId])

  useEffect(() => {
    reload()
    // ponytail: any change anywhere refetches everything. Fine for one shop; switch to per-table patches if reloads get slow.
    let t: ReturnType<typeof setTimeout>
    const kick = () => { clearTimeout(t); t = setTimeout(reload, 300) }
    const ch = supabase.channel('stock-changes').on('postgres_changes', { event: '*', schema: 'public' }, kick).subscribe()
    const vis = () => { if (document.visibilityState === 'visible') kick() }
    document.addEventListener('visibilitychange', vis)
    const iv = setInterval(kick, 10 * 60e3) // safety net for a dropped connection and the midnight roll-over
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis); clearInterval(iv); clearTimeout(t) }
  }, [reload])

  const value = useMemo(() => raw && { ...derive(raw, userId), reload, setPins: (pins: string[]) => setRaw(r => r && { ...r, pins }) }, [raw, userId, reload])

  if (!value) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      {error
        ? <div className="col" style={{ gap: 12, alignItems: 'center' }}><b>Could not load the stock card.</b><span className="muted">{error}</span><button className="btn btn-acc" onClick={reload}>Try again</button></div>
        : <span className="muted">Loading stock…</span>}
    </div>
  )
  return (
    <DataContext.Provider value={value}>
      {error && <div role="alert" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 80, padding: '8px 16px', background: 'var(--warn-soft)', color: 'var(--ink)', fontSize: 13, textAlign: 'center' }}>Offline or out of date: {error} <a onClick={reload}>Retry</a></div>}
      {children}
    </DataContext.Provider>
  )
}
