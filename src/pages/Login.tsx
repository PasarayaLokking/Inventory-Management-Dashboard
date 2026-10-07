import { useState } from 'react'
import { supabase, loginEmail, errText } from '../lib/supabase.ts'

export function Login() {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!u.trim() || p.length < 6) return setErr('Type your username and your 6-digit PIN.')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(u), password: p })
    setBusy(false)
    if (error) { setP(''); setErr(/invalid/i.test(error.message) ? 'Username or PIN is wrong.' : errText(error)) }
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit() }

  return (
    <div data-screen-label="Login" style={{ minHeight: '100vh', background: 'var(--bg)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="col" style={{ width: '100%', maxWidth: 440, gap: 22 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--acc)', color: 'var(--acc-ink)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 20 }}>S</div>
          <div><div style={{ fontWeight: 700, fontSize: 19, letterSpacing: '-.01em' }}>Stock Management System</div><div className="muted" style={{ fontSize: 13 }}>Sign in to continue</div></div>
        </div>
        <div className="card col" style={{ padding: 26, gap: 18 }}>
          <label className="col" style={{ gap: 6, fontSize: 13, fontWeight: 600 }}>Username
            <input className="inp" value={u} onChange={e => { setU(e.target.value); setErr('') }} onKeyDown={onKey} autoComplete="username" autoCapitalize="none" placeholder="Your username" style={{ height: 46, padding: '0 14px', fontSize: 15 }} />
          </label>
          <label className="col" style={{ gap: 6, fontSize: 13, fontWeight: 600 }}>PIN
            <input className="inp" type="password" inputMode="numeric" value={p} onChange={e => { setP(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }} onKeyDown={onKey} autoComplete="current-password" placeholder="6 digits" style={{ height: 46, padding: '0 14px', fontSize: 15, letterSpacing: '.2em' }} />
          </label>
          {err && <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--neg-soft)', color: 'var(--neg)', fontSize: 13, fontWeight: 600 }}>{err}</div>}
          <button className="btn btn-acc" onClick={submit} disabled={busy} style={{ height: 50, borderRadius: 12, fontSize: 16 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>Forgot your PIN? Ask the shop admin to reset it.</div>
      </div>
    </div>
  )
}
