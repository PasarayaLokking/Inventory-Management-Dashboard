-- Pairs sold per item, size and month: the "Which sizes sell" table on the Sales page.
-- Run once in Supabase Dashboard → SQL Editor, after 0003. Run it before deploying the app that reads it.
-- Same window as sold_monthly (this month plus the 12 before); the app trims it to 12 exactly.

create view public.sold_monthly_size with (security_invoker = true) as
select l.item_id, l.size, date_trunc('month', m.occurred_on)::date as month, (-sum(l.qty))::int as pairs
from public.movement_lines l
join public.movements m on m.id = l.movement_id
where m.voided_at is null and m.type = 'sold' and m.occurred_on >= date_trunc('month', current_date - interval '13 months')
group by l.item_id, l.size, date_trunc('month', m.occurred_on);

grant select on public.sold_monthly_size to authenticated;
