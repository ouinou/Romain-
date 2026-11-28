-- Migration 004 : comptabilité générale (SYSCOHADA révisé).
--
-- Contenu :
--   • plan de comptes de référence (lecture seule, À VALIDER : liste restreinte, voir docs/COMPTABILITE.md) ;
--   • par entreprise : plan de comptes, journaux, exercices, écritures et lignes, groupes de comptes protégés ;
--   • règles garanties par la base, quel que soit le code applicatif :
--       - une ligne porte soit un débit, soit un crédit, en montant entier strictement positif ;
--       - imputation uniquement sur un compte actif et imputable de la même entreprise ;
--       - date de l'écriture comprise dans son exercice, exercice ouvert ;
--       - validation seulement si l'écriture a au moins deux lignes et si débit = crédit ;
--       - numérotation continue par journal et par exercice, attribuée par la base à la validation ;
--       - écriture validée et ses lignes : ni modification ni suppression (correction par extourne) ;
--       - séparation saisie / validation selon le paramètre de l'entreprise (activée par défaut) ;
--       - exercice clôturé : aucune écriture, aucune réouverture ; clôture impossible s'il reste des brouillards.
--
-- Montants : entiers dans la plus petite unité de la devise (FCFA : 0 décimale). Voir companies.currency_decimals.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE companies
  ADD COLUMN currency_decimals SMALLINT NOT NULL DEFAULT 0 CHECK (currency_decimals BETWEEN 0 AND 3);

---------------------------------------------------------------------------
-- Plan de comptes de référence (commun, lecture seule)
---------------------------------------------------------------------------

CREATE TABLE account_reference (
    account_number TEXT PRIMARY KEY CHECK (account_number ~ '^[1-9][0-9]{0,7}$'),
    label TEXT NOT NULL,
    to_verify BOOLEAN NOT NULL DEFAULT true    -- intitulé et numéro à confirmer sur le texte officiel
);

-- Liste RESTREINTE, établie de mémoire professionnelle et NON vérifiée sur la publication officielle
-- du Plan comptable général OHADA (2017). Tous les comptes sont marqués to_verify = true.
-- Classes : 1 et 2 chiffres = comptes de regroupement (non imputables) ; 3 chiffres et plus = imputables.
INSERT INTO account_reference (account_number, label) VALUES
 ('1', 'Comptes de ressources durables'),
 ('2', 'Comptes d''actif immobilisé'),
 ('3', 'Comptes de stocks'),
 ('4', 'Comptes de tiers'),
 ('5', 'Comptes de trésorerie'),
 ('6', 'Comptes de charges des activités ordinaires'),
 ('7', 'Comptes de produits des activités ordinaires'),
 ('8', 'Comptes des autres charges et des autres produits'),
 ('9', 'Comptes des engagements hors bilan et de comptabilité analytique de gestion'),
 ('10', 'Capital'), ('11', 'Réserves'), ('12', 'Report à nouveau'), ('13', 'Résultat net de l''exercice'),
 ('14', 'Subventions d''investissement'), ('15', 'Provisions réglementées et fonds assimilés'),
 ('16', 'Emprunts et dettes assimilées'), ('17', 'Dettes de location-acquisition'),
 ('18', 'Dettes liées à des participations et comptes de liaison'), ('19', 'Provisions financières pour risques et charges'),
 ('21', 'Immobilisations incorporelles'), ('22', 'Terrains'), ('23', 'Bâtiments, installations techniques et agencements'),
 ('24', 'Matériel, mobilier et actifs biologiques'), ('25', 'Avances et acomptes versés sur immobilisations'),
 ('26', 'Titres de participation'), ('27', 'Autres immobilisations financières'), ('28', 'Amortissements'),
 ('29', 'Dépréciations des immobilisations'),
 ('31', 'Marchandises'), ('32', 'Matières premières et fournitures liées'), ('33', 'Autres approvisionnements'),
 ('34', 'Produits en cours'), ('35', 'Services en cours'), ('36', 'Produits finis'), ('37', 'Produits intermédiaires et résiduels'),
 ('38', 'Stocks en cours de route, en consignation ou en dépôt'), ('39', 'Dépréciations des stocks et encours'),
 ('40', 'Fournisseurs et comptes rattachés'), ('41', 'Clients et comptes rattachés'), ('42', 'Personnel'),
 ('43', 'Organismes sociaux'), ('44', 'État et collectivités publiques'), ('45', 'Organismes internationaux'),
 ('46', 'Apporteurs, associés et groupe'), ('47', 'Débiteurs et créditeurs divers'),
 ('48', 'Créances et dettes hors activités ordinaires'), ('49', 'Dépréciations et risques provisionnés (tiers)'),
 ('50', 'Titres de placement'), ('51', 'Valeurs à encaisser'), ('52', 'Banques'),
 ('53', 'Établissements financiers et assimilés'), ('54', 'Instruments de trésorerie'),
 ('56', 'Banques, crédits de trésorerie et d''escompte'), ('57', 'Caisse'),
 ('58', 'Régies d''avances, accréditifs et virements internes'), ('59', 'Dépréciations et risques provisionnés (trésorerie)'),
 ('60', 'Achats et variations de stocks'), ('61', 'Transports'), ('62', 'Services extérieurs'), ('63', 'Autres services extérieurs'),
 ('64', 'Impôts et taxes'), ('65', 'Autres charges'), ('66', 'Charges de personnel'), ('67', 'Frais financiers et charges assimilées'),
 ('68', 'Dotations aux amortissements'), ('69', 'Dotations aux provisions et aux dépréciations'),
 ('70', 'Ventes'), ('71', 'Subventions d''exploitation'), ('72', 'Production immobilisée'),
 ('73', 'Variations des stocks de biens et de services produits'), ('75', 'Autres produits'),
 ('77', 'Revenus financiers et produits assimilés'), ('78', 'Transferts de charges'),
 ('79', 'Reprises de provisions, de dépréciations et autres'),
 ('81', 'Valeurs comptables des cessions d''immobilisations'), ('82', 'Produits des cessions d''immobilisations'),
 ('83', 'Charges hors activités ordinaires'), ('84', 'Produits hors activités ordinaires'),
 ('85', 'Dotations hors activités ordinaires'), ('86', 'Reprises hors activités ordinaires'),
 ('87', 'Participation des travailleurs'), ('88', 'Subventions d''équilibre'), ('89', 'Impôts sur le résultat'),
 ('101', 'Capital social'), ('111', 'Réserve légale'), ('121', 'Report à nouveau créditeur'), ('129', 'Report à nouveau débiteur'),
 ('131', 'Résultat net : bénéfice'), ('139', 'Résultat net : perte'),
 ('162', 'Emprunts et dettes auprès des établissements de crédit'),
 ('244', 'Matériel et mobilier'), ('245', 'Matériel de transport'), ('284', 'Amortissements du matériel'),
 ('311', 'Marchandises A'),
 ('401', 'Fournisseurs, dettes en compte'), ('408', 'Fournisseurs, factures non parvenues'), ('409', 'Fournisseurs débiteurs'),
 ('411', 'Clients'), ('418', 'Clients, produits à recevoir'), ('419', 'Clients créditeurs'),
 ('421', 'Personnel, avances et acomptes'), ('422', 'Personnel, rémunérations dues'), ('431', 'Sécurité sociale'),
 ('441', 'État, impôt sur les bénéfices'), ('443', 'État, TVA facturée'), ('445', 'État, TVA récupérable'),
 ('447', 'État, impôts retenus à la source'), ('471', 'Débiteurs et créditeurs divers'),
 ('476', 'Charges constatées d''avance'), ('477', 'Produits constatés d''avance'),
 ('521', 'Banques locales'), ('571', 'Caisse siège social'), ('585', 'Virements de fonds'),
 ('601', 'Achats de marchandises'), ('602', 'Achats de matières premières et fournitures liées'),
 ('603', 'Variations des stocks de biens achetés'), ('604', 'Achats stockés de matières et fournitures consommables'),
 ('605', 'Autres achats'), ('618', 'Autres frais de transport'), ('622', 'Locations et charges locatives'),
 ('624', 'Entretien, réparations et maintenance'), ('625', 'Primes d''assurance'), ('627', 'Publicité, publications, relations publiques'),
 ('628', 'Frais de télécommunications'), ('631', 'Frais bancaires'), ('632', 'Rémunérations d''intermédiaires et de conseils'),
 ('641', 'Impôts et taxes directs'), ('661', 'Rémunérations directes versées au personnel national'), ('664', 'Charges sociales'),
 ('671', 'Intérêts des emprunts'), ('681', 'Dotations aux amortissements d''exploitation'),
 ('701', 'Ventes de marchandises'), ('702', 'Ventes de produits finis'), ('706', 'Services vendus'), ('707', 'Produits accessoires'),
 ('771', 'Intérêts de prêts');

---------------------------------------------------------------------------
-- Plan de comptes de l'entreprise
---------------------------------------------------------------------------

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    account_number TEXT NOT NULL CHECK (account_number ~ '^[1-9][0-9]{0,11}$'),
    label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 200),
    account_class SMALLINT GENERATED ALWAYS AS (substr(account_number, 1, 1)::smallint) STORED,
    postable BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    source TEXT NOT NULL DEFAULT 'company' CHECK (source IN ('reference', 'company', 'import')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, account_number),
    UNIQUE (id, company_id),
    -- Les classes et comptes principaux (1 et 2 chiffres) servent au regroupement, jamais à l'imputation.
    -- La classe 9 (hors bilan, analytique) n'est pas imputable en comptabilité générale.
    CHECK (NOT postable OR (length(account_number) >= 3 AND account_class <> 9))
);

-- Comptes dont les mouvements ne sont visibles qu'avec une permission précise
-- (banques, personnel, résultat…). Paramétrable par l'entreprise.
CREATE TABLE protected_account_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    prefix TEXT NOT NULL CHECK (prefix ~ '^[1-9][0-9]{0,7}$'),
    label TEXT NOT NULL,
    required_permission TEXT NOT NULL REFERENCES permissions(permission_key),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, prefix, required_permission)
);

---------------------------------------------------------------------------
-- Journaux et exercices
---------------------------------------------------------------------------

CREATE TABLE journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    code TEXT NOT NULL CHECK (code ~ '^[A-Z0-9]{2,6}$'),
    label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 80),
    journal_type TEXT NOT NULL CHECK (journal_type IN ('purchases', 'sales', 'bank', 'cash', 'general', 'opening')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, code),
    UNIQUE (id, company_id)
);

CREATE TABLE fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    code TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{2,12}$'),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Exercice de 12 mois en règle générale ; jusqu'à 24 mois toléré pour un premier exercice (À VÉRIFIER : AUDCIF).
    CHECK (end_date > start_date AND end_date < start_date + interval '24 months'),
    CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    UNIQUE (company_id, code),
    UNIQUE (id, company_id),
    FOREIGN KEY (closed_by, company_id) REFERENCES app_users(id, company_id),
    EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

---------------------------------------------------------------------------
-- Écritures et lignes
---------------------------------------------------------------------------

CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    fiscal_year_id UUID NOT NULL,
    journal_id UUID NOT NULL,
    entry_number INTEGER CHECK (entry_number > 0),
    entry_date DATE NOT NULL,
    piece_reference TEXT NOT NULL CHECK (length(btrim(piece_reference)) BETWEEN 1 AND 60),
    piece_date DATE,
    label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 200),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    validated_by UUID,
    validated_at TIMESTAMPTZ,
    reversal_of UUID,
    reversal_reason TEXT,
    UNIQUE (id, company_id),
    UNIQUE (company_id, journal_id, fiscal_year_id, entry_number),
    CHECK ((status = 'validated') = (entry_number IS NOT NULL AND validated_at IS NOT NULL AND validated_by IS NOT NULL)),
    CHECK (reversal_of IS NULL OR length(btrim(coalesce(reversal_reason, ''))) >= 3),
    FOREIGN KEY (fiscal_year_id, company_id) REFERENCES fiscal_years(id, company_id),
    FOREIGN KEY (journal_id, company_id) REFERENCES journals(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id),
    FOREIGN KEY (validated_by, company_id) REFERENCES app_users(id, company_id),
    FOREIGN KEY (reversal_of, company_id) REFERENCES journal_entries(id, company_id)
);
CREATE UNIQUE INDEX journal_entries_single_reversal ON journal_entries (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX journal_entries_company_date ON journal_entries (company_id, entry_date);

CREATE TABLE entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    entry_id UUID NOT NULL,
    line_no SMALLINT NOT NULL CHECK (line_no > 0),
    account_id UUID NOT NULL,
    label TEXT CHECK (label IS NULL OR length(label) <= 200),
    debit BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
    CHECK ((debit > 0) <> (credit > 0)),          -- soit un débit, soit un crédit, jamais les deux ni aucun
    UNIQUE (entry_id, line_no),
    FOREIGN KEY (entry_id, company_id) REFERENCES journal_entries(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (account_id, company_id) REFERENCES accounts(id, company_id)
);
CREATE INDEX entry_lines_account ON entry_lines (company_id, account_id);

---------------------------------------------------------------------------
-- Règles garanties par des déclencheurs
---------------------------------------------------------------------------

CREATE FUNCTION journal_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fy fiscal_years;
  nb integer; total_d numeric; total_c numeric;
  separation boolean;
  origine journal_entries;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validated' THEN
      RAISE EXCEPTION 'Écriture validée n° % : suppression interdite. Corrigez-la par une extourne.', OLD.entry_number
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'validated' THEN
      RAISE EXCEPTION 'Écriture validée n° % : modification interdite. Corrigez-la par une extourne.', OLD.entry_number
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.created_by <> OLD.created_by OR NEW.company_id <> OLD.company_id OR NEW.reversal_of IS DISTINCT FROM OLD.reversal_of THEN
      RAISE EXCEPTION 'Champs non modifiables (auteur, entreprise, écriture d''origine).' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO fy FROM fiscal_years WHERE id = NEW.fiscal_year_id;
  IF fy.status <> 'open' THEN
    RAISE EXCEPTION 'L''exercice % est clôturé : aucune écriture ne peut y être enregistrée.', fy.code USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.entry_date < fy.start_date OR NEW.entry_date > fy.end_date THEN
    RAISE EXCEPTION 'La date % n''appartient pas à l''exercice % (du % au %).', NEW.entry_date, fy.code, fy.start_date, fy.end_date
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Une écriture est d''abord enregistrée en brouillard, puis validée.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reversal_of IS NOT NULL THEN
      SELECT * INTO origine FROM journal_entries WHERE id = NEW.reversal_of;
      IF origine.status <> 'validated' OR origine.reversal_of IS NOT NULL THEN
        RAISE EXCEPTION 'Seule une écriture validée, qui n''est pas elle-même une extourne, peut être extournée.' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'validated' THEN
    SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO nb, total_d, total_c
      FROM entry_lines WHERE entry_id = NEW.id;
    IF nb < 2 THEN
      RAISE EXCEPTION 'Validation refusée : une écriture comporte au moins deux lignes.' USING ERRCODE = 'check_violation';
    END IF;
    IF total_d <> total_c THEN
      RAISE EXCEPTION 'Validation refusée : écriture déséquilibrée (débit % ≠ crédit %).', total_d, total_c USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM entry_lines l JOIN accounts a ON a.id = l.account_id
                WHERE l.entry_id = NEW.id AND (NOT a.active OR NOT a.postable)) THEN
      RAISE EXCEPTION 'Validation refusée : un compte utilisé est archivé ou non imputable.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce((settings->>'separationSaisieValidation')::boolean, true) INTO separation FROM companies WHERE id = NEW.company_id;
    -- L'extourne est une correction encadrée (permission dédiée, motif, confirmation) : non soumise à la séparation.
    IF separation AND NEW.reversal_of IS NULL AND NEW.validated_by = NEW.created_by THEN
      RAISE EXCEPTION 'Séparation des tâches : une autre personne que l''auteur doit valider cette écriture.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Numéro suivant du journal pour l'exercice, sans trou : verrou par (journal, exercice).
    PERFORM pg_advisory_xact_lock(hashtextextended('journal_entries:' || NEW.journal_id::text || ':' || NEW.fiscal_year_id::text, 0));
    SELECT coalesce(max(entry_number), 0) + 1 INTO NEW.entry_number
      FROM journal_entries WHERE journal_id = NEW.journal_id AND fiscal_year_id = NEW.fiscal_year_id;
    NEW.validated_at := now();
  ELSE
    NEW.entry_number := NULL; NEW.validated_at := NULL; NEW.validated_by := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER journal_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_guard();

CREATE FUNCTION entry_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text; acc accounts;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.entry_id <> OLD.entry_id THEN
    RAISE EXCEPTION 'Une ligne ne change pas d''écriture.' USING ERRCODE = 'check_violation';
  END IF;
  -- Lors d'une suppression en cascade d'un brouillard, l'écriture n'est déjà plus visible : st est NULL.
  SELECT status INTO st FROM journal_entries WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  IF st = 'validated' THEN
    RAISE EXCEPTION 'Les lignes d''une écriture validée ne peuvent être ni ajoutées, ni modifiées, ni supprimées.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO acc FROM accounts WHERE id = NEW.account_id;
  IF NOT acc.active OR NOT acc.postable THEN
    RAISE EXCEPTION 'Le compte % n''est pas imputable ou est archivé.', acc.account_number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER entry_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON entry_lines
  FOR EACH ROW EXECUTE FUNCTION entry_lines_guard();

CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER entry_lines_no_truncate BEFORE TRUNCATE ON entry_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE FUNCTION fiscal_years_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'L''exercice % est clôturé : il ne peut être ni modifié ni rouvert.', OLD.code USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date THEN
    IF EXISTS (SELECT 1 FROM journal_entries WHERE fiscal_year_id = OLD.id) THEN
      RAISE EXCEPTION 'Les dates d''un exercice qui contient des écritures ne peuvent plus changer.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'closed' THEN
    IF EXISTS (SELECT 1 FROM journal_entries WHERE fiscal_year_id = OLD.id AND status = 'draft') THEN
      RAISE EXCEPTION 'Clôture impossible : des brouillards restent dans l''exercice %. Validez-les ou supprimez-les.', OLD.code
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fiscal_years_guard BEFORE UPDATE ON fiscal_years FOR EACH ROW EXECUTE FUNCTION fiscal_years_guard();

---------------------------------------------------------------------------
-- Initialisation de la comptabilité d'une entreprise (contexte : current_company_id())
---------------------------------------------------------------------------

CREATE FUNCTION accounting_initialize(p_year integer) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO accounts (account_number, label, postable, source)
  SELECT r.account_number, r.label, length(r.account_number) >= 3 AND left(r.account_number, 1) <> '9', 'reference'
    FROM account_reference r
  ON CONFLICT (company_id, account_number) DO NOTHING;

  INSERT INTO journals (code, label, journal_type) VALUES
    ('AC', 'Achats', 'purchases'), ('VT', 'Ventes', 'sales'), ('BQ', 'Banque', 'bank'),
    ('CA', 'Caisse', 'cash'), ('OD', 'Opérations diverses', 'general')
  ON CONFLICT (company_id, code) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM fiscal_years) THEN
    INSERT INTO fiscal_years (code, start_date, end_date)
    VALUES (p_year::text, make_date(p_year, 1, 1), make_date(p_year, 12, 31));
  END IF;

  INSERT INTO protected_account_groups (prefix, label, required_permission) VALUES
    ('52', 'Banques', 'treasury.read'),
    ('56', 'Banques, crédits de trésorerie et d''escompte', 'treasury.read'),
    ('42', 'Personnel (rémunérations, avances)', 'payroll.read'),
    ('66', 'Charges de personnel', 'payroll.read'),
    ('13', 'Résultat net de l''exercice', 'reports.read')
  ON CONFLICT DO NOTHING;
END $$;

---------------------------------------------------------------------------
-- Isolation, droits et initialisation des entreprises existantes
---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'protected_account_groups', 'journals', 'fiscal_years', 'journal_entries', 'entry_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I
                      USING (company_id = current_company_id())
                      WITH CHECK (company_id = current_company_id())', t);
  END LOOP;
END $$;

GRANT SELECT ON account_reference TO gc_app;
GRANT SELECT, INSERT, UPDATE ON accounts, journals, fiscal_years TO gc_app;   -- pas de DELETE : on archive
GRANT SELECT, INSERT, DELETE ON protected_account_groups TO gc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO gc_app;            -- DELETE/UPDATE limités aux brouillards par déclencheur
GRANT SELECT, INSERT, DELETE ON entry_lines TO gc_app;
GRANT EXECUTE ON FUNCTION accounting_initialize(integer) TO gc_app;
GRANT SELECT ON account_reference, accounts, protected_account_groups, journals, fiscal_years, journal_entries, entry_lines TO gc_backup;

-- Entreprises déjà créées : plan, journaux, exercice de l'année en cours, groupes protégés,
-- et droits comptables complétés pour le rôle système « Directeur financier » : saisie (le comptable
-- n'a pas accès aux banques par défaut), administration du plan et des exercices.
DO $$
DECLARE e record;
BEGIN
  FOR e IN SELECT id FROM companies LOOP
    PERFORM set_config('app.company_id', e.id::text, true);
    PERFORM accounting_initialize(extract(year FROM now())::integer);
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r, permissions p
     WHERE r.role_key = 'finance_director' AND r.is_system_role
       AND p.permission_key IN ('accounting.admin', 'accounting.create', 'accounting.update', 'accounting.submit')
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END $$;
