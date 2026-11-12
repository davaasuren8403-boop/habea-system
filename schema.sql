-- ХАБЭА зааварчилгаа уншуулах систем: Supabase өгөгдлийн сангийн бүтэц
-- Supabase → SQL Editor дээр бүтнээр нь нэг удаа ажиллуулна.

create extension if not exists pgcrypto;

-- 1. Хүснэгтүүд ---------------------------------------------------------

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  full_name text not null,
  position text,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  body text not null,
  deadline date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  position text,
  signature text not null
    check (signature like 'data:image/png;base64,%' and length(signature) < 300000),
  signed_at timestamptz not null default now(),
  unique (document_id, user_id)
);

create index if not exists idx_documents_school on public.documents(school_id);
create index if not exists idx_ack_document on public.acknowledgements(document_id);
create index if not exists idx_profiles_school on public.profiles(school_id);

-- 2. Туслах функцүүд ------------------------------------------------------

create or replace function public.my_school()
returns uuid language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- Ажилтан сургуулийн кодоор өөрийн профайлыг үүсгэнэ (role үргэлж 'staff')
create or replace function public.join_school(p_code text, p_name text, p_position text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_school uuid;
begin
  if auth.uid() is null then
    raise exception 'Нэвтрээгүй байна';
  end if;
  select id into v_school from public.schools where join_code = lower(trim(p_code));
  if v_school is null then
    raise exception 'Сургуулийн код буруу байна';
  end if;
  insert into public.profiles (id, school_id, full_name, position, role)
  values (auth.uid(), v_school, trim(p_name), nullif(trim(p_position), ''), 'staff')
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.join_school(text, text, text) from public, anon;
grant execute on function public.join_school(text, text, text) to authenticated;

-- Гарын үсгийн мөрөнд нэр, албан тушаал, сургуулийг серверээс тохируулна
-- (клиентээс хуурамчаар илгээх боломжгүй болгоно)
create or replace function public.ack_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    raise exception 'Профайл олдсонгүй';
  end if;
  new.user_id := p.id;
  new.school_id := p.school_id;
  new.full_name := p.full_name;
  new.position := p.position;
  new.signed_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ack_fill on public.acknowledgements;
create trigger trg_ack_fill before insert on public.acknowledgements
  for each row execute function public.ack_fill();

-- 3. Row Level Security (сургууль бүрийн өгөгдлийг тусгаарлана) ---------------

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.acknowledgements enable row level security;

drop policy if exists schools_select on public.schools;
create policy schools_select on public.schools
  for select to authenticated using (id = public.my_school());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or (school_id = public.my_school() and public.is_admin()));

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (school_id = public.my_school() and (active or public.is_admin()));

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (school_id = public.my_school() and public.is_admin());

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (school_id = public.my_school() and public.is_admin())
  with check (school_id = public.my_school() and public.is_admin());

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (school_id = public.my_school() and public.is_admin());

drop policy if exists ack_select on public.acknowledgements;
create policy ack_select on public.acknowledgements
  for select to authenticated
  using (user_id = auth.uid() or (school_id = public.my_school() and public.is_admin()));

drop policy if exists ack_insert on public.acknowledgements;
create policy ack_insert on public.acknowledgements
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and school_id = public.my_school()
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.school_id = public.my_school() and d.active
    )
  );

-- Гарын үсгийг засах, устгах policy оруулаагүй тул өөрчлөх боломжгүй.

-- 4. Эхний сургууль болон админ үүсгэх (гараар, нэг удаа) -------------------
-- a) Сургуулиа нэмнэ:
--      insert into public.schools (name) values ('Таны сургуулийн нэр') returning id, join_code;
-- b) Админ өөрөө index.html дээр бүртгүүлж, сургуулийн кодоор нэгдсэний дараа:
--      update public.profiles set role = 'admin'
--      where id = (select id from auth.users where email = 'admin@example.com');
