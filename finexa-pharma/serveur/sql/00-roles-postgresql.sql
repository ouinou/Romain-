-- GESTIONNAIRE COMPTABLE : préparation de PostgreSQL (à exécuter UNE fois, en superutilisateur).
-- Remplacez les deux mots de passe par des valeurs longues et aléatoires, et conservez-les
-- dans le fichier de configuration du serveur, pas ici.
--
--   psql -U postgres -f sql/00-roles-postgresql.sql
--
-- gc_owner : propriétaire des tables, utilisé uniquement pour les migrations et les outils d'exploitation.
-- gc_app   : compte utilisé par le serveur au quotidien ; soumis à la RLS, sans UPDATE/DELETE sur le journal.

CREATE ROLE gc_owner LOGIN PASSWORD 'A-REMPLACER-proprietaire' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE gc_app   LOGIN PASSWORD 'A-REMPLACER-application' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

CREATE DATABASE finexa_pharma OWNER gc_owner ENCODING 'UTF8' TEMPLATE template0;

\connect finexa_pharma
ALTER SCHEMA public OWNER TO gc_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE finexa_pharma FROM PUBLIC;
GRANT CONNECT ON DATABASE finexa_pharma TO gc_owner, gc_app;

-- gc_backup : sauvegardes uniquement (lecture seule, contourne la RLS pour copier toutes les entreprises).
-- Les droits de lecture sont accordés par la migration 002.
\connect postgres
CREATE ROLE gc_backup LOGIN PASSWORD 'A-REMPLACER-sauvegarde' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT CONNECT ON DATABASE finexa_pharma TO gc_backup;
