import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.')

export const supabase = createClient(url, key)

// Staff sign in with a username; Supabase Auth wants an email. Accounts are created as <username>@<LOGIN_DOMAIN>.
// No mail is ever sent to this address.
export const LOGIN_DOMAIN = 'kasut.local'
export const loginEmail = (username: string) => { const u = username.trim().toLowerCase(); return u.includes('@') ? u : u + '@' + LOGIN_DOMAIN }

/** Supabase error → a sentence staff can read. */
export const errText = (e: unknown) => {
  const m = (e as { message?: string })?.message || String(e)
  if (/fetch|network/i.test(m)) return 'No connection. Check the Wi-Fi and try again. Nothing was saved.'
  return m
}

/** Reads every row of a table or view, past the API's per-request row cap. */
export async function fetchAll<T>(table: string, select: string, order: string[]): Promise<T[]> {
  const out: T[] = []
  for (;;) {
    let q = supabase.from(table).select(select)
    for (const col of order) q = q.order(col)
    const { data, error } = await q.range(out.length, out.length + 999)
    if (error) throw error
    if (!data.length) return out
    out.push(...(data as T[]))
  }
}
