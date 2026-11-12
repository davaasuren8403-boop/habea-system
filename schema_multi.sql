-- Олон сургуулийн давхарга: лиценз, ажилтны хязгаар, супер админ
-- schema.sql-ийг ажиллуулсны ДАРАА нэг удаа ажиллуулна.

-- 1. Сургуулийн лицензийн талбарууд --------------------------------------

alter table public.schools add column if not exists active boolean not null default true;
alter table public.schools add column if not exists expires_at date;          -- null = хугацаагүй
alter table public.schools add column if not exists staff_limit int not null default 50;
alter table public.schools add column if not exists contact text;
alter table public.schools add column if not exists note text;

-- 2. Супер админ (бүтээгдэхүүний эзэн) ----------------------------------------

create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.super_admins enable row level security;
-- Policy байхгүй: шууд хандах боломжгүй, доорх функцүүдээр л шалгана.

create or replace function public.am_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins where user_id = auth.uid())
$$;

-- Сургууль идэвхтэй, лицензийн хугацаа дуусаагүй эсэх
create or replace function public.school_ok(p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.schools s
    where s.id = p_school and s.active and (s.expires_at is null or s.expires_at >= current_date)
  )
$$;

-- 3. Лицензийг бичих үйлдлүүд дээр мөрдүүлэх ---------------------------------
-- Хугацаа дууссан сургуульд шинэ заавар нэмэх, гарын үсэг зурах боломжгүй.
-- Өмнөх өгөгдөл, тайланг унших боломж хэвээр үлдэнэ.

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (school_id = public.my_school() and public.is_admin() and public.school_ok(school_id));

drop policy if exists ack_insert on public.acknowledgements;
create policy ack_insert on public.acknowledgements
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and school_id = public.my_school()
    and public.school_ok(school_id)
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.school_id = public.my_school() and d.active
    )
  );

-- Нэгдэхэд сургуулийн лиценз, ажилтны хязгаарыг шалгана
create or replace function public.join_school(p_code text, p_name text, p_position text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_school public.schools%rowtype;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Нэвтрээгүй байна';
  end if;
  select * into v_school from public.schools where join_code = lower(trim(p_code));
  if v_school.id is null then
    raise exception 'Сургуулийн код буруу байна';
  end if;
  if not public.school_ok(v_school.id) then
    raise exception 'Сургуулийн лицензийн хугацаа дууссан эсвэл идэвхгүй байна';
  end if;
  select count(*) into v_count from public.profiles where school_id = v_school.id;
  if v_count >= v_school.staff_limit then
    raise exception 'Сургуулийн ажилтны хязгаарт хүрсэн байна';
  end if;
  insert into public.profiles (id, school_id, full_name, position, role)
  values (auth.uid(), v_school.id, trim(p_name), nullif(trim(p_position), ''), 'staff')
  on conflict (id) do nothing;
end;
$$;

-- 4. Супер админы RPC-үүд --------------------------------------------------

create or replace function public.super_school_stats()
returns table (
  id uuid, name text, join_code text, active boolean, expires_at date,
  staff_limit int, contact text, note text,
  staff_count bigint, admin_count bigint, doc_count bigint, ack_count bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.am_super_admin() then
    raise exception 'Эрх хүрэхгүй';
  end if;
  return query
    select s.id, s.name, s.join_code, s.active, s.expires_at, s.staff_limit, s.contact, s.note,
      (select count(*) from public.profiles p where p.school_id = s.id),
      (select count(*) from public.profiles p where p.school_id = s.id and p.role = 'admin'),
      (select count(*) from public.documents d where d.school_id = s.id),
      (select count(*) from public.acknowledgements a where a.school_id = s.id)
    from public.schools s
    order by s.created_at desc;
end;
$$;

create or replace function public.super_create_school(
  p_name text, p_expires date, p_limit int, p_contact text
) returns table (id uuid, join_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_code text;
begin
  if not public.am_super_admin() then
    raise exception 'Эрх хүрэхгүй';
  end if;
  insert into public.schools (name, expires_at, staff_limit, contact)
  values (trim(p_name), p_expires, greatest(coalesce(p_limit, 50), 1), nullif(trim(p_contact), ''))
  returning schools.id, schools.join_code into v_id, v_code;
  return query select v_id, v_code;
end;
$$;

create or replace function public.super_update_school(
  p_id uuid, p_active boolean, p_expires date, p_limit int, p_note text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.am_super_admin() then
    raise exception 'Эрх хүрэхгүй';
  end if;
  update public.schools
    set active = p_active,
        expires_at = p_expires,
        staff_limit = greatest(coalesce(p_limit, staff_limit), 1),
        note = p_note
  where id = p_id;
end;
$$;

-- Бүртгүүлж нэгдсэн хэрэглэгчийг тухайн сургуулийн админ болгоно
create or replace function public.super_set_school_admin(p_school uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not public.am_super_admin() then
    raise exception 'Эрх хүрэхгүй';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Энэ имэйлээр бүртгэл олдсонгүй. Эхлээд index.html дээр бүртгүүлнэ үү';
  end if;
  update public.profiles set role = 'admin' where id = v_user and school_id = p_school;
  if not found then
    raise exception 'Энэ хэрэглэгч уг сургуулийн кодоор нэгдээгүй байна';
  end if;
end;
$$;

revoke all on function public.am_super_admin() from public, anon;
revoke all on function public.super_school_stats() from public, anon;
revoke all on function public.super_create_school(text, date, int, text) from public, anon;
revoke all on function public.super_update_school(uuid, boolean, date, int, text) from public, anon;
revoke all on function public.super_set_school_admin(uuid, text) from public, anon;
grant execute on function public.am_super_admin() to authenticated;
grant execute on function public.super_school_stats() to authenticated;
grant execute on function public.super_create_school(text, date, int, text) to authenticated;
grant execute on function public.super_update_school(uuid, boolean, date, int, text) to authenticated;
grant execute on function public.super_set_school_admin(uuid, text) to authenticated;

-- 5. Өөрийгөө супер админ болгох (гараар, нэг удаа) ---------------------------
-- Эхлээд өөрийн имэйлээр бүртгүүлсний дараа:
--   insert into public.super_admins (user_id)
--   select id from auth.users where email = 'таны@имэйл';
