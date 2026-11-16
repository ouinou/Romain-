-- Tests des protections de la base, joués comme un visiteur anonyme (rôle anon).
-- À lancer dans une transaction annulée :  begin; <migration éventuelle>; <ce fichier>; rollback;
-- Utilise un mot de passe de test posé temporairement : rien n'est conservé après le rollback.

create temp table r (n serial, test text, ok boolean, detail text);
grant all on r to anon, authenticated;
grant all on sequence r_n_seq to anon, authenticated;

-- mot de passe de test, au format de l'ancienne empreinte SHA-256 (pour tester la migration vers bcrypt)
update public.iti_admin_config set password_hash = encode(extensions.digest('Test-Mdp-ITI-2026!', 'sha256'), 'hex') where id = 1;
delete from public.iti_security_log where ip like '203.0.113.%';

insert into r (test, ok, detail)
select 'Contenu actuel accepté par la validation : ' || key, public.iti_contenu_valide(key, value), null
from public.site_content;

do $$
declare
  v_tok text; v_tok2 text; v_ticket text; b boolean; n int; j jsonb; t text;
  procedure_ok boolean;
begin
  perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', true);
  execute 'set local role anon';

  -- Accès direct aux tables
  begin perform 1 from public.iti_admin_config; insert into r(test,ok) values ('Lecture de la config admin refusée', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Lecture de la config admin refusée', true); end;
  begin insert into public.site_content(key,value) values ('hero','{}'); insert into r(test,ok) values ('Écriture directe du contenu refusée', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Écriture directe du contenu refusée', true); end;
  begin update public.site_content set value='{}' where key='hero'; insert into r(test,ok) values ('Modification directe refusée', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Modification directe refusée', true); end;
  begin delete from public.site_content; insert into r(test,ok) values ('Suppression directe refusée', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Suppression directe refusée', true); end;
  begin truncate public.site_content; insert into r(test,ok) values ('TRUNCATE refusé', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('TRUNCATE refusé', true); end;
  select count(*) into n from public.site_content where key = 'contact_messages';
  insert into r(test,ok,detail) values ('Messages de contact invisibles au public', n = 0, n || ' ligne(s)');
  begin perform 1 from public.iti_security_log; insert into r(test,ok) values ('Journal de sécurité invisible au public', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Journal de sécurité invisible au public', true); end;
  begin perform 1 from public.iti_admin_sessions; insert into r(test,ok) values ('Sessions invisibles au public', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Sessions invisibles au public', true); end;
  begin perform public.iti_keep_history(); insert into r(test,ok) values ('Fonction interne non appelable', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Fonction interne non appelable', true);
            when others then insert into r(test,ok,detail) values ('Fonction interne non appelable', false, sqlerrm); end;
  begin perform public.iti_log('faux', null); insert into r(test,ok) values ('Écriture dans le journal impossible', false);
  exception when insufficient_privilege then insert into r(test,ok) values ('Écriture dans le journal impossible', true); end;

  -- Stockage
  begin
    delete from storage.objects where bucket_id = 'iti-images'; get diagnostics n = row_count;
    insert into r(test,ok,detail) values ('Images impossibles à supprimer', n = 0, n || ' supprimée(s)');
  exception when insufficient_privilege then insert into r(test,ok) values ('Images impossibles à supprimer', true); end;

  -- Connexion
  b := public.iti_check_admin('mauvais-mot-de-passe');
  insert into r(test,ok) values ('Mauvais mot de passe refusé', not b);
  t := public.iti_login('mauvais');
  insert into r(test,ok) values ('Login refusé sans le bon mot de passe', t is null);
  v_tok := public.iti_login('Test-Mdp-ITI-2026!');
  insert into r(test,ok,detail) values ('Login accepté (ancienne empreinte SHA-256)', v_tok is not null, length(v_tok)::text || ' caractères');
  execute 'reset role';
  select password_hash like '$2a$10$%' into b from public.iti_admin_config;
  insert into r(test,ok) values ('Empreinte convertie en bcrypt après connexion', b);
  execute 'set local role anon';
  v_tok2 := public.iti_login('Test-Mdp-ITI-2026!');
  insert into r(test,ok) values ('Login accepté (bcrypt)', v_tok2 is not null);

  -- Enregistrement du contenu
  b := public.iti_save_content('faq', '[{"q":"test","a":"ok"}]', v_tok);
  insert into r(test,ok) values ('Enregistrement accepté avec un jeton valide', b);
  b := public.iti_save_content('faq', '[{"q":"test","a":"ok"}]', 'Test-Mdp-ITI-2026!');
  insert into r(test,ok) values ('Enregistrement accepté avec le mot de passe (compatibilité étape 1)', b);
  b := public.iti_save_content('faq', '[]', repeat('a', 43));
  insert into r(test,ok) values ('Jeton inventé refusé', not b);
  b := public.iti_save_content('faq', '[]', '');
  insert into r(test,ok) values ('Enregistrement sans authentification refusé', not b);
  b := public.iti_save_content('admin_config', '{}', v_tok);
  insert into r(test,ok) values ('Rubrique hors liste blanche refusée', not b);
  b := public.iti_save_content('social', '[{"key":"facebook","url":"javascript:alert(1)"}]', v_tok);
  insert into r(test,ok) values ('Lien javascript: refusé', not b);
  b := public.iti_save_content('articles', '[{"contenu":"<img src=x onerror=alert(1)>"}]', v_tok);
  insert into r(test,ok) values ('HTML avec gestionnaire onerror refusé', not b);
  b := public.iti_save_content('articles', '[{"contenu":"<script>alert(1)</script>"}]', v_tok);
  insert into r(test,ok) values ('Balise <script> refusée', not b);
  b := public.iti_save_content('hero', to_jsonb(repeat('x', 2100000)), v_tok);
  insert into r(test,ok) values ('Contenu de plus de 2 Mo refusé', not b);
  j := public.iti_get_contact_messages(repeat('b', 43));
  insert into r(test,ok) values ('Messages refusés avec un faux jeton', j = '[]'::jsonb);
  j := public.iti_get_contact_messages(v_tok);
  insert into r(test,ok,detail) values ('Messages lisibles avec un jeton valide', jsonb_typeof(j) = 'array', jsonb_array_length(j) || ' message(s)');

  -- Envoi d'images
  v_ticket := public.iti_upload_ticket(v_tok);
  insert into r(test,ok) values ('Ticket d''envoi délivré à l''admin', v_ticket ~ '^[0-9a-f]{32}$');
  insert into r(test,ok) values ('Ticket valide reconnu', public.iti_ticket_valide(v_ticket));
  insert into r(test,ok) values ('Ticket inventé refusé', not public.iti_ticket_valide(md5('x')));
  insert into r(test,ok) values ('Ticket refusé sans session', public.iti_upload_ticket('nimporte-quoi') is null);

  -- Formulaire de contact
  b := public.iti_add_contact_message('{"name":"Test","email":"pas-un-email","message":"x"}');
  insert into r(test,ok) values ('Contact : e-mail invalide refusé', not b);
  b := public.iti_add_contact_message('{"name":"","email":"a@b.cm","message":"x"}');
  insert into r(test,ok) values ('Contact : nom vide refusé', not b);
  for i in 1..5 loop b := public.iti_add_contact_message('{"name":"Test","email":"test@exemple.cm","message":"bonjour"}'); end loop;
  insert into r(test,ok) values ('Contact : 5 messages légitimes acceptés', b);
  b := public.iti_add_contact_message('{"name":"Test","email":"test@exemple.cm","message":"bonjour"}');
  insert into r(test,ok) values ('Contact : 6e message en 1 h depuis la même IP bloqué', not b);

  -- Changement de mot de passe
  b := public.iti_change_password('Test-Mdp-ITI-2026!', 'court');
  insert into r(test,ok) values ('Nouveau mot de passe trop court refusé', not b);
  b := public.iti_change_password('Test-Mdp-ITI-2026!', 'Nouveau-Mdp-Solide-2026');
  insert into r(test,ok) values ('Changement de mot de passe accepté', b);
  insert into r(test,ok) values ('Anciennes sessions fermées après changement', not public.iti_session_valide(v_tok2));

  -- Force brute
  for i in 1..5 loop perform public.iti_login('essai-' || i); end loop;
  t := public.iti_login('Nouveau-Mdp-Solide-2026');
  insert into r(test,ok) values ('Force brute : bloqué après 5 échecs, même avec le bon mot de passe', t is null);
  perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.99"}', true);
  t := public.iti_login('Nouveau-Mdp-Solide-2026');
  insert into r(test,ok) values ('Force brute : une autre IP n''est pas bloquée', t is not null);
  perform public.iti_logout(t);
  insert into r(test,ok) values ('Déconnexion : le jeton ne marche plus', not public.iti_session_valide(t));
  execute 'reset role';
end $$;

insert into r(test,ok,detail)
select 'Historique : ancienne version sauvegardée avant modification', count(*) > 0, count(*) || ' copie(s)'
from public.site_content_backup where key = 'faq' and saved_at > now() - interval '1 minute';
insert into r(test,ok,detail)
select 'Journal : événements enregistrés', count(*) >= 10, string_agg(distinct event, ', ')
from public.iti_security_log where ip like '203.0.113.%';
insert into r(test,ok,detail)
select 'Bucket limité à 10 Mo et aux images', file_size_limit = 10485760 and not ('image/svg+xml' = any(allowed_mime_types)),
       file_size_limit || ' / ' || array_to_string(allowed_mime_types, ',')
from storage.buckets where id = 'iti-images';
insert into r(test,ok,detail)
select 'Plus de règle de suppression publique sur les images', count(*) = 0, string_agg(policyname, ',')
from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE';

select n, case when ok then 'OK' else 'ÉCHEC' end as resultat, test, detail from r order by n;
