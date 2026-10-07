// One-time import of the shop's current stock into Supabase.
//
//   npm run import -- stock.csv            dry run: checks the file and prints what would be created
//   npm run import -- stock.csv --commit   writes categories, items and one "Opening stock" entry
//
// CSV columns (same layout as the app's Stock → Download CSV), one row per item and size:
//   Item, Colour, Brand, Details, Category, Size system (UK / EU / Capal), Size, Pairs in stock
// Only Item, Size system, Size and Pairs are required. Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--')), commit = args.includes('--commit'), force = args.includes('--force')
if (!file) { console.error('Usage: npm run import -- <file.csv> [--commit]'); process.exit(1) }

function parseCsv(text) {
  const rows = [[]]; let f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { rows.at(-1).push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; rows.at(-1).push(f); f = ''; rows.push([]) }
    else f += c
  }
  rows.at(-1).push(f)
  return rows.filter(r => r.some(x => x.trim()))
}

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const SYS = { uk: 'UK', eu: 'EU', capal: 'CAP', cap: 'CAP' }
const RANGE = { UK: [4, 12], EU: [33, 48], CAP: [1, 13] }

// ── read and check the file ──
const [header, ...rows] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''))
const head = header.map(h => h.trim().toLowerCase())
const at = (...names) => head.findIndex(h => names.includes(h))
const C = { item: at('item'), colour: at('colour', 'color'), brand: at('brand'), details: at('details'), category: at('category'), sys: at('size system'), size: at('size'), pairs: at('pairs in stock', 'pairs') }
for (const k of ['item', 'sys', 'size', 'pairs']) if (C[k] < 0) { console.error(`Missing column "${k === 'sys' ? 'Size system' : k}". Found: ${header.join(', ')}`); process.exit(1) }

const items = new Map(), errors = [], warnings = []
rows.forEach((r, i) => {
  const line = i + 2, get = k => (C[k] >= 0 ? (r[C[k]] ?? '').trim() : '')
  const tag = get('item'), sys = SYS[get('sys').toLowerCase()], size = Number(get('size')), pairs = Number(get('pairs') || 0)
  if (!tag) return errors.push(`line ${line}: no item name`)
  if (!sys) return errors.push(`line ${line}: size system "${get('sys')}" must be UK, EU or Capal`)
  if (!Number.isInteger(size)) return errors.push(`line ${line}: size "${get('size')}" is not a whole number`)
  if (!Number.isInteger(pairs)) return errors.push(`line ${line}: pairs "${get('pairs')}" is not a whole number`)
  const key = norm(tag)
  if (!items.has(key)) items.set(key, { tag, colour: get('colour'), brand: get('brand'), details: get('details'), category: get('category') || 'Uncategorised', sys, sizes: new Map() })
  const it = items.get(key)
  if (it.sys !== sys) return errors.push(`line ${line}: ${tag} is ${it.sys} on an earlier line but ${sys} here`)
  if (it.sizes.has(size)) return errors.push(`line ${line}: ${tag} size ${size} appears twice`)
  it.sizes.set(size, pairs)
  if (size < RANGE[sys][0] || size > RANGE[sys][1]) warnings.push(`line ${line}: ${tag} size ${size} is outside the usual ${sys} range ${RANGE[sys].join('–')}`)
  if (pairs < 0) warnings.push(`line ${line}: ${tag} size ${size} has ${pairs} pairs (below zero)`)
})

const list = [...items.values()]
const cats = [...new Set(list.map(i => i.category))]
const totalPairs = list.reduce((a, i) => a + [...i.sizes.values()].reduce((x, y) => x + y, 0), 0)
console.log(`${file}: ${rows.length} rows → ${list.length} items in ${cats.length} categories, ${totalPairs} pairs`)
console.log('Categories: ' + cats.map(c => `${c} (${list.filter(i => i.category === c).length})`).join(', '))
warnings.forEach(w => console.log('  warning ' + w))
if (errors.length) { errors.forEach(e => console.error('  error ' + e)); console.error(`\n${errors.length} errors. Fix the file and run again. Nothing was written.`); process.exit(1) }
if (!commit) { console.log('\nDry run only. Nothing was written. Add --commit to import.'); process.exit(0) }

// ── write ──
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })
const must = ({ data, error }) => { if (error) { console.error('Supabase error: ' + error.message); process.exit(1) } return data }

// importing twice would double every count
const { count: openCount } = await db.from('movements').select('id', { count: 'exact', head: true }).eq('type', 'open').is('voided_at', null)
if (openCount && !force) { console.error('Opening stock was already imported. Re-running would double the stock. Use --force only if you voided the old import.'); process.exit(1) }

const HUES = [250, 45, 300, 150, 200, 15, 95, 330]
const existingCats = must(await db.from('categories').select('id,name,hue,sort_order'))
const catId = new Map(existingCats.map(c => [c.name.toLowerCase(), c.id]))
const newCats = cats.filter(c => !catId.has(c.toLowerCase()))
if (newCats.length) {
  const used = new Set(existingCats.map(c => c.hue))
  const free = HUES.filter(h => !used.has(h))
  const made = must(await db.from('categories').insert(newCats.map((name, k) => ({ name, hue: free[k] ?? HUES[k % HUES.length], sort_order: existingCats.length + k }))).select('id,name'))
  made.forEach(c => catId.set(c.name.toLowerCase(), c.id))
}

const existing = must(await db.from('items').select('id,tag,size_from,size_to').is('removed_at', null))
const itemId = new Map(existing.map(i => [norm(i.tag), i.id]))
const outside = existing.flatMap(e => { const i = items.get(norm(e.tag)); return i ? [...i.sizes.keys()].filter(z => z < e.size_from || z > e.size_to).map(z => `${e.tag} size ${z} (app range ${e.size_from}–${e.size_to})`) : [] })
if (outside.length) { console.error("These sizes are outside the item's range in the app. Widen the range with Edit item first:\n  " + outside.join('\n  ')); process.exit(1) }
const fresh = list.filter(i => !itemId.has(norm(i.tag)))
for (let k = 0; k < fresh.length; k += 200) {
  const made = must(await db.from('items').insert(fresh.slice(k, k + 200).map(i => {
    const sizes = [...i.sizes.keys()]
    return { tag: i.tag, colour: i.colour, brand: i.brand, details: i.details, category_id: catId.get(i.category.toLowerCase()), size_system: i.sys, size_from: Math.min(...sizes), size_to: Math.max(...sizes) }
  })).select('id,tag'))
  made.forEach(i => itemId.set(norm(i.tag), i.id))
}

const lines = list.flatMap(i => [...i.sizes].filter(([, q]) => q !== 0).map(([size, qty]) => ({ item_id: itemId.get(norm(i.tag)), size, qty })))
const [move] = must(await db.from('movements').insert({ type: 'open', note: 'Opening stock (imported from ' + file.split(/[\\/]/).pop() + ')' }).select('id'))
for (let k = 0; k < lines.length; k += 500) must(await db.from('movement_lines').insert(lines.slice(k, k + 500).map(l => ({ ...l, movement_id: move.id }))))

console.log(`\nImported: ${newCats.length} new categories, ${fresh.length} new items (${list.length - fresh.length} already existed), ${lines.length} size lines, ${totalPairs} pairs.`)
console.log('If anything looks wrong, open Supabase → Table editor → movements, and set voided_at on the "Opening stock" row to undo the counts.')
