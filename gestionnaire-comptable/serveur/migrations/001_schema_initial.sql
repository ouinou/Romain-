-- Migration 001 : schéma initial fourni par le porteur du projet, repris sans modification
-- (seuls BEGIN/COMMIT sont retirés : l'outil de migration ouvre lui-même la transaction).
-- Les corrections et compléments sont dans 002_securite_et_audit.sql.

-- GESTIONNAIRE COMPTABLE
-- Schéma initial PostgreSQL : entreprises, utilisateurs, rôles, permissions et audit.
-- À faire examiner et tester par un développeur avant toute utilisation réelle.
-- Ce fichier ne configure pas à lui seul un serveur sécurisé.


CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_code TEXT NOT NULL UNIQUE,
    legal_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'disabled', 'locked')),
    failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, email),
    UNIQUE (id, company_id)
);

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    role_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, role_key),
    UNIQUE (id, company_id)
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id, role_id),
    FOREIGN KEY (user_id, company_id) REFERENCES app_users(id, company_id),
    FOREIGN KEY (role_id, company_id) REFERENCES roles(id, company_id),
    FOREIGN KEY (assigned_by, company_id) REFERENCES app_users(id, company_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    company_id UUID NOT NULL REFERENCES companies(id),
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id),
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, role_id, permission_id),
    FOREIGN KEY (role_id, company_id) REFERENCES roles(id, company_id),
    FOREIGN KEY (granted_by, company_id) REFERENCES app_users(id, company_id)
);

-- Journal applicatif : les comptes standards ne doivent avoir aucun droit UPDATE/DELETE.
-- La protection forte nécessite aussi des droits SQL séparés, sauvegardes externes et tests.
CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    actor_user_id UUID,
    event_type TEXT NOT NULL,
    object_type TEXT,
    object_id TEXT,
    outcome TEXT NOT NULL DEFAULT 'success'
        CHECK (outcome IN ('success', 'denied', 'failure')),
    event_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    previous_hash TEXT,
    event_hash TEXT,
    FOREIGN KEY (actor_user_id, company_id)
        REFERENCES app_users(id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_users_company_status
    ON app_users(company_id, status);
CREATE INDEX IF NOT EXISTS idx_roles_company
    ON roles(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_company_time
    ON audit_events(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time
    ON audit_events(company_id, actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_type
    ON audit_events(company_id, event_type);

-- Liste initiale de permissions. À compléter avec les modules métier.
INSERT INTO permissions (permission_key, description) VALUES
 ('users.read', 'Consulter les utilisateurs'),
 ('users.create', 'Créer des utilisateurs'),
 ('users.update', 'Modifier les profils utilisateurs'),
 ('users.disable', 'Désactiver un compte'),
 ('roles.manage', 'Gérer les rôles et permissions'),
 ('company.settings.manage', 'Modifier les paramètres de l’entreprise'),
 ('finance.dashboard.read', 'Consulter le tableau de bord financier'),
 ('finance.transactions.read', 'Consulter les opérations financières autorisées'),
 ('finance.transactions.create', 'Créer des opérations financières'),
 ('finance.transactions.correct', 'Corriger une opération selon la procédure'),
 ('finance.reports.read', 'Consulter les rapports financiers autorisés'),
 ('bank_accounts.read', 'Consulter les comptes bancaires autorisés'),
 ('payroll.read', 'Consulter les données de paie autorisées'),
 ('stock.read', 'Consulter les stocks'),
 ('stock.manage', 'Gérer les mouvements de stock'),
 ('purchases.manage', 'Gérer les achats et approvisionnements'),
 ('audit.read', 'Consulter le journal d’audit'),
 ('audit.export', 'Exporter le journal d’audit'),
 ('backups.manage', 'Gérer les sauvegardes')
ON CONFLICT (permission_key) DO NOTHING;

-- Modèle de référence de rôles à créer pour chaque entreprise.
-- Les comptes administrateurs doivent être initialisés par un processus sécurisé côté serveur.
-- Ne pas stocker un "code maître" en clair dans la base.
