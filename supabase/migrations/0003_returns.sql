-- Stock in comes in two kinds: Supply ('in', from a supplier) and Return ('ret', a customer brings a pair back).
-- Run once in Supabase Dashboard → SQL Editor, after 0001 and 0002. Run it before deploying the app that reads in_daily.

-- Staff may now record returns at the counter. Same function as 0001; only the role check changed.
-- create or replace keeps the grants from 0001.
create or replace function public.record_movement(p_type text, p_date date, p_note text, p_lines jsonb) returns uuid
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
  if p_type not in ('sold', 'in', 'ret') and not is_admin() then raise exception 'Only an admin can record this'; end if;
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

-- Stock in per day, size and kind: the Supply / Return figures on the Stock and Sales pages.
-- 370 days covers the Sales page's 12-month period; the app trims it exactly.
create view public.in_daily with (security_invoker = true) as
select l.item_id, l.size, m.type, m.occurred_on as day, sum(l.qty)::int as pairs
from public.movement_lines l
join public.movements m on m.id = l.movement_id
where m.voided_at is null and m.type in ('in', 'ret') and m.occurred_on > current_date - 370
group by l.item_id, l.size, m.type, m.occurred_on;

grant select on public.in_daily to authenticated;
