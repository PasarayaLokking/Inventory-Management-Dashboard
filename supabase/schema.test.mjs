// Runs the real migration in PGlite (Postgres in WASM) with minimal Supabase stubs, then checks roles, RPCs, RLS and views.
// npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const migration = readFileSync(new URL('./migrations/0001_schema.sql', import.meta.url), 'utf8')
const whatsapp = readFileSync(new URL('./migrations/0002_whatsapp_alarm.sql', import.meta.url), 'utf8').replace(/create extension .*/, '') // pg_net is stubbed below
const returns = readFileSync(new URL('./migrations/0003_returns.sql', import.meta.url), 'utf8')
const db = new PGlite()
let pass = 0
const ok = (name) => { pass++; console.log('  ✔ ' + name) }

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create publication supabase_realtime;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
  create schema net; create table net.sent (url text, params jsonb);
  create function net.http_get(url text, params jsonb) returns bigint language sql as $$ insert into net.sent values (url, params); select 1::bigint $$;
`)
await db.exec(migration)
await db.exec(whatsapp)
await db.exec(returns)
ok('migrations run')

const ADMIN = '00000000-0000-0000-0000-00000000000a', STAFF = '00000000-0000-0000-0000-00000000000b'
await db.exec(`insert into auth.users(id,email) values ('${ADMIN}','hafiz@kasut.local'),('${STAFF}','aina@kasut.local')`)
await db.exec(`update profiles set role='admin' where username='hafiz'`)

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
  try { return (await db.query(sql, params)).rows } finally { await db.exec('reset role') }
}
const fails = async (uid, sql, params, re) => { await assert.rejects(() => as(uid, sql, params), re) }
const move = (uid, type, lines, note = '') => as(uid, `select record_movement($1, current_date, $2, $3::jsonb) as id`, [type, note, JSON.stringify(lines)]).then(r => r[0].id)
const stock = async (item, size) => (await as(ADMIN, `select coalesce((select qty from stock where item_id=$1 and size=$2),0) as q`, [item, size]))[0].q

const profs = await as(STAFF, `select username, display_name, role from profiles order by username`)
assert.deepEqual(profs.map(p => [p.username, p.display_name, p.role]), [['aina', 'Aina', 'staff'], ['hafiz', 'Hafiz', 'admin']])
ok('signup trigger creates profiles; admin promoted')

const [cat] = await as(ADMIN, `insert into categories(name,hue,sort_order) values ('School shoes',250,0) returning id`)
const [item] = await as(ADMIN, `insert into items(tag,category_id,size_system,size_from,size_to) values ('Y329',$1,'UK',4,12) returning id, code`, [cat.id])
assert.equal(item.code, 'K1001')
ok('admin adds category + item (code K1001)')

await fails(STAFF, `insert into items(tag,category_id,size_system,size_from,size_to) values ('Y330',$1,'UK',4,12)`, [cat.id], /row-level security/)
await as(STAFF, `update categories set name='x'`) // RLS makes this match 0 rows rather than error
assert.equal((await as(ADMIN, `select name from categories where id=$1`, [cat.id]))[0].name, 'School shoes')
ok('staff cannot add items or edit categories')

await fails(ADMIN, `insert into items(tag,category_id,size_system,size_from,size_to) values ('y-329',$1,'UK',4,12)`, [cat.id], /duplicate key/)
ok('"y-329" clashes with "Y329" (normalised unique name)')

await move(ADMIN, 'in', [{ item_id: item.id, size: 5, qty: 10 }], 'INV-1')
assert.equal(await stock(item.id, 5), 10)
const sale = await move(STAFF, 'sold', [{ item_id: item.id, size: 5, qty: -2 }, { item_id: item.id, size: 6, qty: -1 }], '4821')
assert.equal(await stock(item.id, 5), 8)
assert.equal(await stock(item.id, 6), -1)
ok('stock in +10, staff sale −2 → 8; selling a size with none goes below zero')

await fails(STAFF, `select record_movement('sold', current_date, '', '[{"item_id":"${item.id}","size":5,"qty":2}]'::jsonb)`, [], /Wrong sign/)
await fails(STAFF, `select record_movement('count', current_date, '', '[{"item_id":"${item.id}","size":5,"qty":2}]'::jsonb)`, [], /Only an admin/)
await fails(STAFF, `select record_movement('ret', current_date, '', '[{"item_id":"${item.id}","size":5,"qty":-2}]'::jsonb)`, [], /Wrong sign/)
await fails(STAFF, `select record_movement('sold', current_date, '', '[{"item_id":"${item.id}","size":13,"qty":-1}]'::jsonb)`, [], /does not come in size 13/)
await fails(STAFF, `select record_movement('sold', current_date, '', '[]'::jsonb)`, [], /Nothing to save/)
await fails(STAFF, `select record_movement('open', current_date, '', '[{"item_id":"${item.id}","size":5,"qty":2}]'::jsonb)`, [], /Unknown entry type/)
ok('RPC rejects wrong sign, staff count, out-of-range size, empty, open')

await move(STAFF, 'ret', [{ item_id: item.id, size: 5, qty: 2 }], 'Refund, receipt 4821')
assert.equal(await stock(item.id, 5), 10)
ok('staff can record a Return: +2 → 10')

await move(ADMIN, 'count', [{ item_id: item.id, size: 5, qty: 6 }, { item_id: item.id, size: 6, qty: 0 }])
assert.equal(await stock(item.id, 5), 6)
assert.equal(await stock(item.id, 6), 0)
assert.equal(await move(ADMIN, 'count', [{ item_id: item.id, size: 5, qty: 6 }]), null)
ok('count records the difference (10→6, −1→0); a matching count saves nothing')

await move(ADMIN, 'ex', [{ item_id: item.id, size: 5, qty: 1 }, { item_id: item.id, size: 7, qty: -1 }])
assert.equal(await stock(item.id, 5), 7)
ok('size exchange moves a pair between sizes')

const adminSale = await move(ADMIN, 'sold', [{ item_id: item.id, size: 5, qty: -1 }])
await fails(STAFF, `select void_movement($1)`, [adminSale], /only undo your own/)
await as(STAFF, `select void_movement($1)`, [sale])
await fails(STAFF, `select void_movement($1)`, [sale], /only undo your own/) // already voided
await db.exec(`update movements set created_at = now() - interval '2 days' where id = '${adminSale}'`)
const old = await move(STAFF, 'sold', [{ item_id: item.id, size: 4, qty: -1 }])
await db.exec(`update movements set created_at = now() - interval '2 days' where id = '${old}'`)
await fails(STAFF, `select void_movement($1)`, [old], /only undo your own/)
await as(ADMIN, `select void_movement($1)`, [old])
ok('undo: staff own+today only, once; admin can undo anything')

const voided = await as(ADMIN, `select count(*)::int as n from movements where voided_at is not null`)
assert.equal(voided[0].n, 2)
ok('undo keeps the voided rows (audit trail)')

await fails(STAFF, `insert into movement_lines(movement_id,item_id,size,qty) values ($1,$2,5,5)`, [adminSale, item.id], /row-level security|permission denied/)
await fails(ADMIN, `insert into movements(type) values ('in')`, [], /row-level security|permission denied/)
ok('nobody writes movements directly, not even admin')

const daily = await as(STAFF, `select size, pairs from sold_daily where item_id=$1 order by size`, [item.id])
assert.deepEqual(daily.map(r => [r.size, r.pairs]), [[5, 1]]) // the voided staff sale is gone; admin sale of 1 counts
const monthly = await as(STAFF, `select pairs from sold_monthly where item_id=$1`, [item.id])
assert.equal(monthly[0].pairs, 1)
ok('sold_daily / sold_monthly count only live sales')

await as(STAFF, `select void_movement($1)`, [await move(STAFF, 'ret', [{ item_id: item.id, size: 6, qty: 1 }])])
const ins = await as(STAFF, `select type, size, pairs from in_daily where item_id=$1 order by type`, [item.id])
assert.deepEqual(ins.map(r => [r.type, r.size, r.pairs]), [['in', 5, 10], ['ret', 5, 2]])
ok('in_daily splits Supply and Return, without undone entries')

assert.equal(await as(null, `select count(*)::int as n from items`).then(r => r[0].n, e => (/permission denied/.test(e.message) ? 0 : -1)), 0)
await fails(null, `select record_movement('sold', current_date, '', '[]'::jsonb)`, [], /permission denied/)
ok('anon sees no rows and cannot call the RPC')

await as(STAFF, `insert into pins(item_id) values ($1)`, [item.id])
await fails(STAFF, `insert into pins(user_id,item_id) values ($1,$2)`, [ADMIN, item.id], /row-level security/)
assert.equal((await as(ADMIN, `select count(*)::int as n from pins`))[0].n, 0)
ok('pins are private per user')

await as(ADMIN, `update items set removed_at = now() where id=$1`, [item.id])
await fails(ADMIN, `select record_movement('in', current_date, '', '[{"item_id":"${item.id}","size":5,"qty":1}]'::jsonb)`, [], /not found or removed/)
await as(ADMIN, `insert into items(tag,category_id,size_system,size_from,size_to) values ('Y329',$1,'UK',4,12)`, [cat.id])
ok('removed items take no new entries, and free their name')

const [w] = await as(ADMIN, `insert into items(tag,category_id,size_system,size_from,size_to,alarm_on,alarm_th) values ('W1',$1,'UK',4,12,true,1) returning id`, [cat.id])
const sent = async () => (await db.query(`select params->>'text' as t from net.sent`)).rows.map(r => r.t)
await move(ADMIN, 'in', [{ item_id: w.id, size: 5, qty: 3 }, { item_id: w.id, size: 6, qty: 1 }])
await move(STAFF, 'sold', [{ item_id: w.id, size: 5, qty: -1 }, { item_id: w.id, size: 6, qty: -1 }]) // size 6 rings, but no number saved yet
assert.deepEqual(await sent(), [])
await db.exec(`insert into vault.decrypted_secrets values ('whatsapp_phone','+60123456789'),('whatsapp_apikey','k')`)
await move(STAFF, 'sold', [{ item_id: w.id, size: 5, qty: -1 }, { item_id: w.id, size: 6, qty: -1 }])
await move(ADMIN, 'in', [{ item_id: w.id, size: 5, qty: 5 }])
assert.deepEqual(await sent(), ['*Low-stock alarm*\nW1 size 5: 1 left\nW1 size 6: none left'])
ok('WhatsApp: one message per sale that hits the alarm level; nothing for stock in or before the number is saved')

await db.exec(`create or replace function net.http_get(url text, params jsonb) returns bigint language plpgsql as $$ begin raise exception 'down'; end $$`)
await move(STAFF, 'sold', [{ item_id: w.id, size: 5, qty: -6 }])
assert.equal(await stock(w.id, 5), 0)
ok('a failed WhatsApp send never blocks the sale')

const pub = await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)
assert.deepEqual(pub.rows.map(r => r.tablename), ['categories', 'items', 'movement_lines', 'movements'])
ok('realtime publication has the 4 live tables')

console.log(`\n${pass} checks passed`)
