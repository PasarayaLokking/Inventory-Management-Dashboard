// One-time import of past sales from the old stock cards, as history. Stock stays exactly as it is now.
//
//   npm run import-sales -- sales.json            dry run: checks the file and prints what would be created
//   npm run import-sales -- sales.json --commit   writes dated sales/supplies plus one balance entry that cancels them
//
// JSON: [{ "item": "Y 329", "date": "2026-09-14", "type": "sold" | "in", "sizes": { "8": 1, "9": 2 } }]  (qty are positive pairs)
// Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. Undo: set voided_at on the "Old sales" rows in movements.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--')), commit = process.argv.includes('--commit')
if (!file) { console.error('Usage: npm run import-sales -- <file.json> [--commit]'); process.exit(1) }
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })
const must = ({ data, error }) => { if (error) { console.error('Supabase error: ' + error.message); process.exit(1) } return data }
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const NOTE = 'Old sales (from the old stock cards)', BAL = 'Balance for old sales: cancels the entries above so stock stays as counted'

const rows = JSON.parse(readFileSync(file, 'utf8'))
const items = must(await db.from('items').select('id,tag,size_from,size_to').is('removed_at', null))
const byTag = new Map(items.map(i => [norm(i.tag), i]))
const errors = [], moves = new Map()    // "date|type" -> lines
for (const r of rows) {
  const it = byTag.get(norm(r.item))
  if (!it) { errors.push(`${r.item}: not in the dashboard`); continue }
  for (const [s, q] of Object.entries(r.sizes)) {
    const size = Number(s)
    if (!Number.isInteger(size) || size < it.size_from || size > it.size_to) { errors.push(`${r.item} ${r.date}: size ${s} is outside ${it.size_from}–${it.size_to}`); continue }
    if (!Number.isInteger(q) || q <= 0) { errors.push(`${r.item} ${r.date}: quantity ${q} must be a positive whole number`); continue }
    const k = r.date + '|' + r.type
    if (!moves.has(k)) moves.set(k, [])
    moves.get(k).push({ item_id: it.id, size, qty: r.type === 'sold' ? -q : q })
  }
}
const all = [...moves.values()].flat()
const net = new Map()                   // item|size -> qty to cancel
for (const l of all) net.set(l.item_id + '|' + l.size, (net.get(l.item_id + '|' + l.size) ?? 0) - l.qty)
const balance = [...net].filter(([, q]) => q !== 0).map(([k, qty]) => ({ item_id: k.split('|')[0], size: Number(k.split('|')[1]), qty }))
const pairs = t => all.filter(l => (t === 'sold') === (l.qty < 0)).reduce((a, l) => a + Math.abs(l.qty), 0)
console.log(`${file}: ${rows.length} rows → ${moves.size} dated entries, ${pairs('sold')} pairs sold, ${pairs('in')} pairs supplied, ${balance.length} balance lines`)
if (errors.length) { errors.forEach(e => console.error('  error ' + e)); console.error(`\n${errors.length} errors. Nothing was written.`); process.exit(1) }
if (!commit) { console.log('\nDry run only. Nothing was written. Add --commit to import.'); process.exit(0) }

// importing twice would double every entry
const { count } = await db.from('movements').select('id', { count: 'exact', head: true }).eq('note', NOTE).is('voided_at', null)
if (count) { console.error('Old sales were already imported. Void those entries in movements first.'); process.exit(1) }

const ordered = [...moves].sort(([a], [b]) => a.localeCompare(b))
for (const [k, lines] of ordered) {
  const [date, type] = k.split('|')
  const [m] = must(await db.from('movements').insert({ type, occurred_on: date, note: NOTE }).select('id'))
  must(await db.from('movement_lines').insert(lines.map(l => ({ ...l, movement_id: m.id }))))
}
const [b] = must(await db.from('movements').insert({ type: 'open', note: BAL }).select('id'))
for (let i = 0; i < balance.length; i += 500) must(await db.from('movement_lines').insert(balance.slice(i, i + 500).map(l => ({ ...l, movement_id: b.id }))))
console.log(`\nImported ${moves.size} entries and one balance entry. Stock is unchanged.`)
