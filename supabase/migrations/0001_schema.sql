-- Kasut Stock Card · schema
-- Run once in Supabase Dashboard → SQL Editor (new project).
-- Stock is never stored directly: it is the sum of movement lines, so every change has a who/when/why.

-- ───────────────────────── tables ─────────────────────────

create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text not null unique,
  display_name text not null,
  role         text not null default 'staff' check (role in ('admin', 'staff'))
);

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  hue        int,                                   -- null = grey
  sort_order int not null default 0,
  alarm_on   boolean not null default false,
  alarm_th   int not null default 2 check (alarm_th >= 0)
);
create unique index categories_name_key on public.categories (lower(btrim(name)));

create sequence public.item_code_seq start 1001;

create table public.items (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default 'K' || nextval('public.item_code_seq'),
  tag         text not null check (btrim(tag) <> ''),
  colour      text not null default '',
  brand       text not null default '',
  details     text not null default '',
  note        text not null default '',
  category_id uuid not null references public.categories,
  size_system text not null check (size_system in ('UK', 'EU', 'CAP')),
  size_from   int not null,
  size_to     int not null,
  alarm_on    boolean,                              -- null = follow the category alarm
  alarm_th    int check (alarm_th >= 0),
  alarm_why   text not null default '',
  removed_at  timestamptz,                          -- soft delete: past sales stay in reports
  created_at  timestamptz not null default now(),
  check (size_from <= size_to)
);
-- "Line 7 2146" and "line7-2146" are the same item
create unique index items_tag_key on public.items (regexp_replace(lower(tag), '[^a-z0-9]', '', 'g')) where removed_at is null;

create table public.movements (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('sold', 'in', 'ret', 'count', 'ex', 'open')),
  occurred_on date not null default current_date,
  note        text not null default '',
  created_by  uuid references public.profiles,     -- null = imported
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,                          -- undo keeps the row for the audit trail
  voided_by   uuid references public.profiles
);
create index movements_occurred_on_idx on public.movements (occurred_on);
create index movements_created_at_idx on public.movements (created_at);

create table public.movement_lines (
  id          bigint generated always as identity primary key,
  movement_id uuid not null references public.movements on delete cascade,
  item_id     uuid not null references public.items,
  size        int not null,
  qty         int not null check (qty <> 0)         -- signed: sale −, stock in +
);
create index movement_lines_item_idx on public.movement_lines (item_id, size);
create index movement_lines_movement_idx on public.movement_lines (movement_id);

create table public.pins (
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  primary key (user_id, item_id)
);

insert into public.categories (name, hue, sort_order) values ('Uncategorised', null, 999);

-- ───────────────────────── views ─────────────────────────

create view public.stock with (security_invoker = true) as
select l.item_id, l.size, sum(l.qty)::int as qty
from public.movement_lines l
join public.movements m on m.id = l.movement_id
where m.voided_at is null
group by l.item_id, l.size;

-- Sales feeds for the insights. Windows are a little wider than needed; the app trims them exactly.
-- daily, per size: 7/30/90-day figures, weekly sparklines, sizes that sell
create view public.sold_daily with (security_invoker = true) as
select l.item_id, l.size, m.occurred_on as day, (-sum(l.qty))::int as pairs
from public.movement_lines l
join public.movements m on m.id = l.movement_id
where m.voided_at is null and m.type = 'sold' and m.occurred_on > current_date - 100
group by l.item_id, l.size, m.occurred_on;

-- monthly, per item: 12-month bars, trends, last sale date
create view public.sold_monthly with (security_invoker = true) as
select l.item_id, date_trunc('month', m.occurred_on)::date as month, (-sum(l.qty))::int as pairs, max(m.occurred_on) as last_day
from public.movement_lines l
join public.movements m on m.id = l.movement_id
where m.voided_at is null and m.type = 'sold' and m.occurred_on >= date_trunc('month', current_date - interval '13 months')
group by l.item_id, date_trunc('month', m.occurred_on);

-- ───────────────────────── functions ─────────────────────────

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

-- Every stock change goes through here: one transaction, role and sign checked.
-- lines: [{item_id, size, qty}]  · qty is signed, except for 'count' where it is the number counted on the shelf.
create function public.record_movement(p_type text, p_date date, p_note text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_line jsonb;
  v_item items;
  v_size int;
  v_qty  int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_type not in ('sold', 'in', 'ret', 'count', 'ex') then raise exception 'Unknown entry type %', p_type; end if;
  if p_type not in ('sold', 'in') and not is_admin() then raise exception 'Only an admin can record this'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Nothing to save'; end if;

  insert into movements (type, occurred_on, note, created_by)
  values (p_type, coalesce(p_date, current_date), coalesce(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from items where id = (v_line->>'item_id')::uuid and removed_at is null;
    if not found then raise exception 'Item not found or removed'; end if;
    v_size := (v_line->>'size')::int;
    v_qty  := (v_line->>'qty')::int;
    if v_size not between v_item.size_from and v_item.size_to then
      raise exception '% does not come in size %', v_item.tag, v_size;
    end if;
    if p_type = 'count' then
      if v_qty < 0 then raise exception 'A count cannot be below zero'; end if;
      -- two devices counting the same size at once must not both apply the difference
      perform pg_advisory_xact_lock(hashtext(v_item.id::text || ':' || v_size));
      v_qty := v_qty - coalesce((select qty from stock where item_id = v_item.id and size = v_size), 0);
    elsif (p_type = 'sold' and v_qty >= 0) or (p_type in ('in', 'ret') and v_qty <= 0) then
      raise exception 'Wrong sign for % line', p_type;
    end if;
    if v_qty <> 0 then
      insert into movement_lines (movement_id, item_id, size, qty) values (v_id, v_item.id, v_size, v_qty);
    end if;
  end loop;

  if not exists (select 1 from movement_lines where movement_id = v_id) then
    delete from movements where id = v_id;  -- e.g. every count already matched
    return null;
  end if;
  return v_id;
end $$;

-- Undo. Staff: own entries keyed in today (shop time). Admin: anything.
create function public.void_movement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update movements set voided_at = now(), voided_by = auth.uid()
  where id = p_id and voided_at is null
    and (is_admin() or (created_by = auth.uid()
         and (created_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date));
  if not found then raise exception 'You can only undo your own entries from today'; end if;
end $$;

revoke execute on function public.record_movement(text, date, text, jsonb), public.void_movement(uuid) from public, anon;
grant execute on function public.record_movement(text, date, text, jsonb), public.void_movement(uuid) to authenticated;

-- New login → profile row (role staff). Promote with: update profiles set role = 'admin' where username = '…';
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, display_name)
  values (new.id, split_part(new.email, '@', 1),
          coalesce(new.raw_user_meta_data->>'display_name', initcap(split_part(new.email, '@', 1))));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────────────────── row level security ─────────────────────────
-- Everyone signed in can read. Only admins edit items/categories/profiles.
-- Nobody writes movements directly: only through record_movement / void_movement.

-- explicit grants, so this works even on projects that don't auto-expose new tables; RLS below narrows them
grant select on public.profiles, public.categories, public.items, public.movements, public.movement_lines, public.pins, public.stock, public.sold_daily, public.sold_monthly to authenticated;
grant insert, update, delete on public.categories, public.items, public.pins to authenticated;
grant update on public.profiles to authenticated;
grant usage on sequence public.item_code_seq to authenticated;

alter table public.profiles       enable row level security;
alter table public.categories     enable row level security;
alter table public.items          enable row level security;
alter table public.movements      enable row level security;
alter table public.movement_lines enable row level security;
alter table public.pins           enable row level security;

create policy "signed in can read" on public.profiles       for select to authenticated using (true);
create policy "signed in can read" on public.categories     for select to authenticated using (true);
create policy "signed in can read" on public.items          for select to authenticated using (true);
create policy "signed in can read" on public.movements      for select to authenticated using (true);
create policy "signed in can read" on public.movement_lines for select to authenticated using (true);

create policy "admin edits" on public.profiles   for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin edits" on public.categories for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin edits" on public.items      for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "own pins" on public.pins for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────── realtime ─────────────────────────
alter publication supabase_realtime add table public.movements, public.movement_lines, public.items, public.categories;
