import { useState } from 'react'
import { useData } from '../lib/data.tsx'
import { catColor, btnInk } from '../lib/theme.ts'
import { alarmTh, plural } from '../lib/stats.ts'
import { useUi, Switch, ThSelect } from '../ui.tsx'

/** Low-stock alarms drawer: ringing now, add a shoe alarm, per-shoe settings, category defaults. */
export function Alarms() {
  const d = useData(), ui = useUi()
  const [add, setAdd] = useState({ id: '', th: '2', why: '' })
  const watched = d.live.filter(i => i.alarm_on !== null)
  const watchedN = d.live.filter(i => alarmTh(i, d.cats) !== null).length

  async function addAlarm() {
    const th = parseInt(add.th)
    if (!add.id) return ui.toast('Choose a shoe first.', 'err')
    if (isNaN(th) || th < 0) return ui.toast('Type how many pairs counts as low, e.g. 2.', 'err')
    await ui.setItemAlarm(add.id, true, th, false, add.why.trim())
    setAdd({ id: '', th: '2', why: '' })
  }

  return (
    <>
      <div style={{ position: 'relative', padding: '22px 24px 18px', background: 'var(--neg-soft)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, background: 'var(--neg)' }} />
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Pop-up warnings</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 24, letterSpacing: '-.02em' }}>Low-stock alarms</h2>
          <div className="muted" style={{ fontSize: 13, paddingTop: 6, textWrap: 'pretty' }}>Alarms are off unless you turn them on, including for new shoes and new categories. With an alarm on, you get a pop-up as soon as a sale takes any size down to the level you choose.</div>
        </div>
        <button onClick={ui.closeDrawer} aria-label="Close" className="x">×</button>
      </div>
      <div className="col" style={{ flex: 1, overflow: 'auto', padding: '22px 24px 40px', gap: 26 }}>
        <section className="col" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><h3 style={{ margin: 0, fontSize: 15 }}>Ringing now</h3><span className="muted" style={{ fontSize: 12 }}>{plural(watchedN, 'shoe')} watched</span></div>
          {!d.hits.length && <div className="muted" style={{ padding: 14, border: '1px dashed var(--line)', borderRadius: 12, fontSize: 13 }}>{watchedN ? 'Nothing ringing. Every shoe with an alarm is above its alarm level.' : 'No alarms set yet. Turn one on below for a category or a single shoe.'}</div>}
          {d.hits.map(h => (
            <div key={h.it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: 'var(--neg-soft)' }}>
              <button onClick={() => ui.openItem(h.it.id)} className="row-btn" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{h.it.tag}</div>
                <div style={{ fontSize: 12, color: 'var(--neg)', fontWeight: 600 }}>{h.low.map(z => { const v = d.st(h.it.id, z); return 'size ' + z + ': ' + (v <= 0 ? 'none left' : v + ' left') }).join(' · ')}</div>
              </button>
              <button onClick={() => ui.addToIn(h.low.map(z => ({ item_id: h.it.id, size: z })))} style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 8, background: 'var(--c-in)', color: btnInk(ui.dark), fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Stock in</button>
            </div>
          ))}
        </section>

        <section className="col" style={{ padding: 18, border: '2px solid var(--neg)', borderRadius: 16, gap: 12, background: 'var(--surface)' }}>
          <div><h3 style={{ margin: 0, fontSize: 18 }}>Add a shoe alarm</h3><div className="muted" style={{ fontSize: 13, textWrap: 'pretty', paddingTop: 2 }}>Pick a shoe and the number that feels low to you. You know your shelf best.</div></div>
          <label className="lbl">Shoe
            <select className="inp" value={add.id} onChange={e => setAdd({ ...add, id: e.target.value })} style={{ height: 48, fontSize: 15 }}>
              <option value="">Choose a shoe…</option>
              {d.live.slice().sort((a, b) => a.tag.localeCompare(b.tag)).map(i => <option key={i.id} value={i.id}>{i.tag}{i.alarm_on !== null ? ' (has alarm)' : ''}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 15 }}>
            <span>Warn me when any size has</span>
            <input type="number" min={0} inputMode="numeric" className="inp" value={add.th} onChange={e => setAdd({ ...add, th: e.target.value })} aria-label="Alarm level" style={{ width: 80, height: 48, padding: '0 10px', fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
            <span>pairs or fewer</span>
          </div>
          <label className="lbl">Why (optional)
            <input className="inp" value={add.why} onChange={e => setAdd({ ...add, why: e.target.value })} placeholder="e.g. Sells fast before school opens" />
          </label>
          <button onClick={addAlarm} className="btn hov-bright" style={{ height: 50, border: 0, borderRadius: 12, background: ui.dark ? 'oklch(0.48 0.17 27)' : 'oklch(0.53 0.2 27)', color: '#fff', fontSize: 16, fontWeight: 700 }}>Set alarm</button>
        </section>

        <section className="col">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}><h3 style={{ margin: 0, fontSize: 15 }}>Your shoe alarms</h3><span className="muted" style={{ fontSize: 12 }}>{plural(watched.length, 'shoe')}</span></div>
          {!watched.length && <div className="muted" style={{ padding: 14, border: '1px dashed var(--line)', borderRadius: 12, fontSize: 13 }}>No shoe alarms yet. Add one above.</div>}
          {watched.map(i => {
            const on = !!i.alarm_on, th = i.alarm_th ?? 2
            return (
              <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: catColor(d.cats.find(c => c.id === i.category_id)?.hue, ui.dark).cc, flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ell" style={{ fontWeight: 600, fontSize: 15 }}>{i.tag}</div>
                  <div className="muted ell" style={{ fontSize: 12 }}>{(on ? 'Alarm at ' + (th === 0 ? '0' : th + ' or fewer') : 'Paused') + (i.alarm_why ? ' · ' + i.alarm_why : '')}</div>
                </div>
                <ThSelect value={th} off={!on} onChange={v => ui.setItemAlarm(i.id, true, v, true)} />
                <Switch on={on} onClick={() => ui.setItemAlarm(i.id, !on, th)} label="Alarm on or off" />
                <button onClick={() => ui.setItemAlarm(i.id, null, th)} title="Remove alarm" aria-label="Remove alarm" className="hov-neg" style={{ width: 30, height: 30, border: 0, borderRadius: 8, color: 'var(--muted)', fontSize: 17, cursor: 'pointer', flex: '0 0 auto' }}>×</button>
              </div>
            )
          })}
        </section>

        <section className="col">
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>By category</h3>
          <div className="muted" style={{ fontSize: 12, paddingBottom: 8 }}>Covers every shoe in the category, unless a shoe has its own setting.</div>
          {d.cats.map(c => {
            const n = d.live.filter(i => i.category_id === c.id).length
            return (
              <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{plural(n, 'shoe')} · {c.alarm_on ? 'alarm at ' + (c.alarm_th === 0 ? '0' : c.alarm_th + ' or less') : 'alarm off'}</div>
                </div>
                <ThSelect value={c.alarm_th} off={!c.alarm_on} onChange={v => ui.setCatAlarm(c.id, true, v, true)} />
                <Switch on={c.alarm_on} onClick={() => ui.setCatAlarm(c.id, !c.alarm_on, c.alarm_th)} label="Low-stock alarm" />
              </div>
            )
          })}
        </section>
      </div>
    </>
  )
}
