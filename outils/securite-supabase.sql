-- Sécurisation de la base du site ITI (projet Supabase iti-website)
-- Le mot de passe admin actuel reste valable (même empreinte SHA-256).

create table if not exists public.iti_admin_config (
  id int primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.iti_admin_config enable row level security;
revoke all on public.iti_admin_config from anon, authenticated;
insert into public.iti_admin_config (id, password_hash)
values (1, '3c41a1ce211e692387b0b5f2c8059c2b82b9c407d195da7ac2156b2775123737')
on conflict (id) do nothing;

create or replace function public.iti_check_admin(p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean;
begin
  ok := coalesce(p_password, '') <> '' and exists (
    select 1 from public.iti_admin_config
    where id = 1 and password_hash = encode(extensions.digest(p_password, 'sha256'), 'hex'));
  if not ok then perform pg_sleep(1); end if;   -- freine les essais en rafale
  return ok;
end $$;

create or replace function public.iti_save_content(p_key text, p_value jsonb, p_password text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.iti_check_admin(p_password) then return false; end if;
  if p_key is null or length(p_key) > 64 or p_key like '\_%' or p_key = 'admin_hash' then return false; end if;
  insert into public.site_content (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;

create or replace function public.iti_change_password(p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.iti_check_admin(p_old) or length(coalesce(p_new, '')) < 8 then return false; end if;
  update public.iti_admin_config
     set password_hash = encode(extensions.digest(p_new, 'sha256'), 'hex'), updated_at = now()
   where id = 1;
  return true;
end $$;

create or replace function public.iti_add_contact_message(p_message jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare msg jsonb; cur jsonb;
begin
  if jsonb_typeof(p_message) <> 'object' or length(p_message::text) > 6000 then return false; end if;
  msg := jsonb_build_object(
    'id', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'name', left(coalesce(p_message->>'name', ''), 200),
    'email', left(coalesce(p_message->>'email', ''), 200),
    'phone', left(coalesce(p_message->>'phone', ''), 50),
    'subject', left(coalesce(p_message->>'subject', ''), 100),
    'message', left(coalesce(p_message->>'message', ''), 5000),
    'date', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  select value into cur from public.site_content where key = 'contact_messages' for update;
  if cur is null or jsonb_typeof(cur) <> 'array' then cur := '[]'::jsonb; end if;
  cur := cur || jsonb_build_array(msg);
  if jsonb_array_length(cur) > 1000 then
    cur := (select jsonb_agg(e order by o) from jsonb_array_elements(cur) with ordinality t(e, o)
            where o > jsonb_array_length(cur) - 1000);
  end if;
  insert into public.site_content (key, value, updated_at) values ('contact_messages', cur, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;

create or replace function public.iti_get_contact_messages(p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.iti_check_admin(p_password) then return '[]'::jsonb; end if;
  return coalesce((select value from public.site_content where key = 'contact_messages'), '[]'::jsonb);
end $$;

revoke all on function public.iti_check_admin(text), public.iti_save_content(text, jsonb, text),
  public.iti_change_password(text, text), public.iti_add_contact_message(jsonb),
  public.iti_get_contact_messages(text) from public;
grant execute on function public.iti_check_admin(text), public.iti_save_content(text, jsonb, text),
  public.iti_change_password(text, text), public.iti_add_contact_message(jsonb),
  public.iti_get_contact_messages(text) to anon, authenticated;

-- Le public ne peut plus que LIRE le contenu du site (ni les messages, ni les clés techniques)
alter table public.site_content enable row level security;
drop policy if exists "lecture publique du contenu" on public.site_content;
create policy "lecture publique du contenu" on public.site_content for select to anon, authenticated
  using (key not like '\_%' and key not in ('contact_messages', 'admin_hash'));
revoke insert, update, delete on public.site_content from anon, authenticated;

-- Images : plus personne ne peut supprimer les images depuis le site
drop policy if exists delete_images on storage.objects;
