-- Өдөр бүр давтагдах зааварчилгаа: зааварт "давтамж", гарын үсэгт "огноо"
alter table public.documents add column if not exists frequency text not null default 'once';
do $$ begin
  begin alter table public.documents drop constraint documents_frequency_chk; exception when others then null; end;
  alter table public.documents add constraint documents_frequency_chk check (frequency in ('once','daily'));
end $$;
update public.documents set frequency = 'daily' where kind in ('daily','commute');

alter table public.acknowledgements add column if not exists sign_date date;
-- Нэг удаагийн зааварт тогтмол тэмдэг (2000-01-01), өдөр бүрийнд Улаанбаатарын өдөр
update public.acknowledgements a set sign_date = case
  when d.frequency = 'once' then date '2000-01-01'
  else (a.signed_at at time zone 'Asia/Ulaanbaatar')::date end
from public.documents d where d.id = a.document_id and a.sign_date is null;
alter table public.acknowledgements alter column sign_date set not null;

do $$ begin
  begin alter table public.acknowledgements drop constraint acknowledgements_document_id_user_id_key; exception when others then null; end;
  begin alter table public.acknowledgements add constraint ack_doc_user_date_key unique (document_id, user_id, sign_date); exception when others then null; end;
end $$;

create or replace function public.ack_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
  f text;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    raise exception 'Профайл олдсонгүй';
  end if;
  select frequency into f from public.documents where id = new.document_id;
  new.user_id := p.id;
  new.school_id := p.school_id;
  new.full_name := p.full_name;
  new.position := p.position;
  new.signed_at := now();
  new.sign_date := case when coalesce(f,'once') = 'daily'
    then (now() at time zone 'Asia/Ulaanbaatar')::date else date '2000-01-01' end;
  return new;
end;
$$;
