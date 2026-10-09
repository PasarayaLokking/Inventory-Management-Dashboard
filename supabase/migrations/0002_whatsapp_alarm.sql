-- WhatsApp the admin when a change takes a size to or below its alarm level (the same rule as the pop-up).
-- Run once in Supabase Dashboard → SQL Editor, after 0001. Then save the admin's number and CallMeBot key (README step 6):
--   select vault.create_secret('+60123456789', 'whatsapp_phone');
--   select vault.create_secret('1234567', 'whatsapp_apikey');
-- Until both are saved, nothing is sent.

create extension if not exists pg_net with schema extensions;

-- ponytail: CallMeBot is free but only for personal use. If it stops working, point this at the WhatsApp Cloud API instead.
create function public.whatsapp_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_text  text;
  v_phone text;
  v_key   text;
begin
  select string_agg(tag || ' size ' || size || ': ' || case when qty <= 0 then 'none left' else qty || ' left' end, E'\n' order by tag, size)
  into v_text
  from (
    select i.tag, l.size,
           coalesce((select qty from stock where item_id = l.item_id and size = l.size), 0) as qty,
           case when i.alarm_on is not null then case when i.alarm_on then coalesce(i.alarm_th, 2) end
                when c.alarm_on then c.alarm_th end as th  -- a shoe's own setting beats its category's (stats.ts alarmTh)
    from (select item_id, size from movement_lines where movement_id = new.id group by item_id, size having sum(qty) < 0) l
    join items i on i.id = l.item_id and i.removed_at is null
    join categories c on c.id = i.category_id
  ) x
  where qty <= th;
  if v_text is null then return null; end if;

  select decrypted_secret into v_phone from vault.decrypted_secrets where name = 'whatsapp_phone';
  select decrypted_secret into v_key   from vault.decrypted_secrets where name = 'whatsapp_apikey';
  if v_phone is null or v_key is null then return null; end if;

  -- queued now, sent by pg_net after the sale commits; replies land in net._http_response for 6 hours
  perform net.http_get('https://api.callmebot.com/whatsapp.php',
    jsonb_build_object('phone', v_phone, 'apikey', v_key, 'text', '*Low-stock alarm*' || E'\n' || v_text));
  return null;
exception when others then
  raise warning 'WhatsApp alarm not sent: %', sqlerrm;  -- a message must never block a sale
  return null;
end $$;

-- deferred: runs at commit, once record_movement has added every line of the movement
create constraint trigger whatsapp_low_stock after insert on public.movements
deferrable initially deferred for each row execute function public.whatsapp_low_stock();
