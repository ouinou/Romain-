-- Sécurisation de la base du site ITI (projet Supabase iti-website) — étape 1
-- Novembre 2026. Remplace outils/securite-supabase.sql (gardé pour l'historique).
--
-- Compatible avec la version du site actuellement en ligne : l'admin continue
-- de fonctionner avec le mot de passe. L'étape 2 (securite-2026-11-etape2.sql)
-- ferme les anciens accès une fois la nouvelle version du site publiée.

-------------------------------------------------------------------------------
-- 1. Droits sur les tables : le public ne peut que LIRE le contenu publié
-------------------------------------------------------------------------------
revoke all on public.site_content, public.iti_admin_config, public.site_content_backup from anon, authenticated;
grant select on public.site_content to anon, authenticated;
delete from public.site_content where key = '_test_write';

-------------------------------------------------------------------------------
-- 2. Nouvelles tables internes (aucun accès public)
-------------------------------------------------------------------------------
create table if not exists public.iti_admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text
);
create table if not exists public.iti_upload_tickets (
  ticket_hash text primary key,
  expires_at timestamptz not null
);
create table if not exists public.iti_security_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null,
  ip text,
  detail jsonb
);
create index if not exists iti_security_log_event_ip_at on public.iti_security_log (event, ip, at desc);
create index if not exists iti_security_log_at on public.iti_security_log (at desc);

alter table public.iti_admin_sessions enable row level security;
alter table public.iti_upload_tickets enable row level security;
alter table public.iti_security_log enable row level security;
revoke all on public.iti_admin_sessions, public.iti_upload_tickets, public.iti_security_log from anon, authenticated;
revoke all on sequence public.iti_security_log_id_seq from anon, authenticated;

-------------------------------------------------------------------------------
-- 3. Fonctions internes (non appelables depuis le site)
-------------------------------------------------------------------------------
-- Adresse IP du visiteur, transmise par l'API Supabase
create or replace function public.iti_client_ip() returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(trim(split_part(coalesce(
           h->>'cf-connecting-ip', h->>'x-forwarded-for', h->>'x-real-ip', ''), ',', 1)), ''), 'inconnue')
  from (select nullif(current_setting('request.headers', true), '')::json as h) x
$$;

create or replace function public.iti_log(p_event text, p_detail jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.iti_security_log (event, ip, detail) values (p_event, public.iti_client_ip(), p_detail);
$$;

-- Trop d'événements de ce type récemment (pour cette IP ou au total) ?
create or replace function public.iti_trop_de(p_event text, p_max_ip int, p_max_total int, p_fenetre interval)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.iti_client_ip() <> 'inconnue' and (select count(*) from public.iti_security_log
           where event = p_event and ip = public.iti_client_ip() and at > now() - p_fenetre) >= p_max_ip)
      or (select count(*) from public.iti_security_log
           where event = p_event and at > now() - p_fenetre) >= p_max_total
$$;

-- Vérifie le mot de passe admin, avec limite d'essais et journal.
-- Accepte l'ancienne empreinte SHA-256 une dernière fois et la remplace par bcrypt.
create or replace function public.iti_verifier_mot_de_passe(p_password text, p_contexte text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare h text; ok boolean := false;
begin
  if public.iti_trop_de('connexion_echec', 5, 50, interval '15 minutes') then
    perform public.iti_log('connexion_bloquee', jsonb_build_object('contexte', p_contexte));
    return false;
  end if;
  if coalesce(p_password, '') = '' or length(p_password) > 200 then
    perform public.iti_log('connexion_echec', jsonb_build_object('contexte', p_contexte));
    return false;
  end if;
  select password_hash into h from public.iti_admin_config where id = 1;
  if h like '$2%' then
    ok := h = extensions.crypt(p_password, h);
  elsif h is not null then
    ok := h = encode(extensions.digest(p_password, 'sha256'), 'hex');
    if ok then  -- migration transparente vers bcrypt
      update public.iti_admin_config
         set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
       where id = 1;
      perform public.iti_log('empreinte_migree_bcrypt', null);
    end if;
  end if;
  perform public.iti_log(case when ok then 'connexion_ok' else 'connexion_echec' end,
                         jsonb_build_object('contexte', p_contexte));
  return ok;
end $$;

create or replace function public.iti_session_valide(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(length(p_token) between 40 and 100, false) and exists (
    select 1 from public.iti_admin_sessions
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and expires_at > now())
$$;

-- Autorisation admin : jeton de session (nouvelle version du site)
-- ou mot de passe (ancienne version, supprimé à l'étape 2).
create or replace function public.iti_autoriser(p_secret text, p_contexte text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if public.iti_session_valide(p_secret) then return true; end if;
  if length(coalesce(p_secret, '')) between 40 and 100 and p_secret ~ '^[A-Za-z0-9_-]+$' then
    perform public.iti_log('session_invalide', jsonb_build_object('contexte', p_contexte));
    return false;
  end if;
  return public.iti_verifier_mot_de_passe(p_secret, p_contexte);  -- compatibilité, retiré à l'étape 2
end $$;

-- Contenu : liste blanche des rubriques, taille, liens dangereux
create or replace function public.iti_contenu_valide(p_key text, p_value jsonb) returns boolean
language sql immutable set search_path = public as $$
  select p_key in ('articles','projects','testimonials','contact','social','hero','about','stats',
                   'services','faq','formations','image_library','contact_messages')
     and p_value is not null
     and octet_length(p_value::text) <= 2000000
     and (p_key = 'contact_messages' or (      -- les messages sont affichés comme du texte brut
           p_value::text !~* '"\s*(javascript\s*:|vbscript\s*:|data\s*:\s*text/html)'
       and p_value::text !~* '<\s*(script|iframe|object|embed)\M'
       and p_value::text !~* '<[^>]*\son[a-z]+\s*='))
$$;

-------------------------------------------------------------------------------
-- 4. Fonctions appelées par le site
-------------------------------------------------------------------------------
-- Ancienne connexion (version en ligne actuelle) : renvoie vrai/faux
create or replace function public.iti_check_admin(p_password text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  return public.iti_verifier_mot_de_passe(p_password, 'check_admin');
end $$;

-- Nouvelle connexion : renvoie un jeton de session valable 8 h (ou null)
create or replace function public.iti_login(p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not public.iti_verifier_mot_de_passe(p_password, 'login') then return null; end if;
  delete from public.iti_admin_sessions where expires_at < now();
  t := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.iti_admin_sessions (token_hash, expires_at, ip)
  values (encode(extensions.digest(t, 'sha256'), 'hex'), now() + interval '8 hours', public.iti_client_ip());
  return t;
end $$;

create or replace function public.iti_logout(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.iti_admin_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if found then perform public.iti_log('deconnexion', null); end if;
  return true;
end $$;

create or replace function public.iti_save_content(p_key text, p_value jsonb, p_password text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.iti_autoriser(p_password, 'save:' || left(coalesce(p_key, ''), 40)) then return false; end if;
  if not public.iti_contenu_valide(p_key, p_value) then
    perform public.iti_log('contenu_refuse', jsonb_build_object('key', left(coalesce(p_key, ''), 64),
                                                                 'taille', octet_length(coalesce(p_value::text, ''))));
    return false;
  end if;
  insert into public.site_content (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.iti_log('contenu_modifie', jsonb_build_object('key', p_key));
  return true;
end $$;

create or replace function public.iti_change_password(p_old text, p_new text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.iti_verifier_mot_de_passe(p_old, 'change_password') then return false; end if;
  if length(coalesce(p_new, '')) < 12 or length(p_new) > 200 or p_new = p_old then
    perform public.iti_log('mot_de_passe_refuse', jsonb_build_object('raison', 'trop court ou identique'));
    return false;
  end if;
  update public.iti_admin_config
     set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = 1;
  delete from public.iti_admin_sessions;         -- déconnecte toutes les sessions ouvertes
  perform public.iti_log('mot_de_passe_change', null);
  return true;
end $$;

create or replace function public.iti_add_contact_message(p_message jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare msg jsonb; cur jsonb; v_email text; v_name text; v_text text;
begin
  if public.iti_trop_de('contact_envoye', 5, 60, interval '1 hour') then
    perform public.iti_log('contact_bloque', null);
    return false;
  end if;
  if jsonb_typeof(p_message) is distinct from 'object' or length(p_message::text) > 8000 then
    perform public.iti_log('contact_refuse', jsonb_build_object('raison', 'format'));
    return false;
  end if;
  v_name  := btrim(coalesce(p_message->>'name', ''));
  v_email := btrim(coalesce(p_message->>'email', ''));
  v_text  := btrim(coalesce(p_message->>'message', ''));
  if v_name = '' or v_text = '' or length(v_email) > 200
     or v_email !~ '^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$' then
    perform public.iti_log('contact_refuse', jsonb_build_object('raison', 'champs'));
    return false;
  end if;
  msg := jsonb_build_object(
    'id', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'name', left(v_name, 200),
    'email', v_email,
    'phone', left(coalesce(p_message->>'phone', ''), 50),
    'subject', left(coalesce(p_message->>'subject', ''), 100),
    'message', left(v_text, 5000),
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
  perform public.iti_log('contact_envoye', null);
  return true;
end $$;

create or replace function public.iti_get_contact_messages(p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.iti_autoriser(p_password, 'messages') then return '[]'::jsonb; end if;
  return coalesce((select value from public.site_content where key = 'contact_messages'), '[]'::jsonb);
end $$;

-- Ticket d'envoi d'image : valable 10 minutes, sert de dossier dans le bucket
create or replace function public.iti_upload_ticket(p_token text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not public.iti_session_valide(p_token) then
    perform public.iti_log('upload_refuse', null);
    return null;
  end if;
  delete from public.iti_upload_tickets where expires_at < now();
  t := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.iti_upload_tickets values (encode(extensions.digest(t, 'sha256'), 'hex'), now() + interval '10 minutes');
  perform public.iti_log('upload_autorise', null);
  return t;
end $$;

-- Utilisée par la règle du bucket (étape 2)
create or replace function public.iti_ticket_valide(p_ticket text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(p_ticket ~ '^[0-9a-f]{32}$', false) and exists (
    select 1 from public.iti_upload_tickets
     where ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex') and expires_at > now())
$$;

-------------------------------------------------------------------------------
-- 5. Qui peut appeler quoi
-------------------------------------------------------------------------------
revoke all on function
  public.iti_client_ip(), public.iti_log(text, jsonb), public.iti_trop_de(text, int, int, interval),
  public.iti_verifier_mot_de_passe(text, text), public.iti_session_valide(text), public.iti_autoriser(text, text),
  public.iti_contenu_valide(text, jsonb), public.iti_keep_history(),
  public.iti_check_admin(text), public.iti_login(text), public.iti_logout(text),
  public.iti_save_content(text, jsonb, text), public.iti_change_password(text, text),
  public.iti_add_contact_message(jsonb), public.iti_get_contact_messages(text),
  public.iti_upload_ticket(text), public.iti_ticket_valide(text)
from public, anon, authenticated;

grant execute on function
  public.iti_check_admin(text), public.iti_login(text), public.iti_logout(text),
  public.iti_save_content(text, jsonb, text), public.iti_change_password(text, text),
  public.iti_add_contact_message(jsonb), public.iti_get_contact_messages(text),
  public.iti_upload_ticket(text), public.iti_ticket_valide(text)
to anon, authenticated;

-------------------------------------------------------------------------------
-- 6. Historique automatique du contenu (le trigger n'était plus branché)
-------------------------------------------------------------------------------
create or replace function public.iti_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.site_content_backup(reason, key, value)
  values ('historique automatique (' || tg_op || ')', old.key, old.value);
  delete from public.site_content_backup where saved_at < now() - interval '180 days';
  return coalesce(new, old);
end $$;
revoke all on function public.iti_keep_history() from public, anon, authenticated;
drop trigger if exists iti_site_content_history on public.site_content;
create trigger iti_site_content_history before update or delete on public.site_content
  for each row when (old.key <> 'contact_messages') execute function public.iti_keep_history();

-------------------------------------------------------------------------------
-- 7. Stockage des images
-------------------------------------------------------------------------------
drop policy if exists delete_images on storage.objects;      -- n'importe qui pouvait tout supprimer
update storage.buckets
   set file_size_limit = 10485760,                              -- 10 Mo
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'iti-images';
-- L'envoi reste ouvert jusqu'à l'étape 2 (la version en ligne du site en a besoin).
