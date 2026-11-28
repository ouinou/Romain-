-- Migration 005 : trésorerie (caisses, banques, mobile money), ventes et facturation.
--
-- Principe : les opérations du quotidien (vente, prestation, encaissement, dépense, transfert) s'enregistrent
-- sans connaître les comptes. Chaque opération produit automatiquement une écriture comptable en BROUILLARD,
-- que le comptable valide ensuite (séparation des tâches respectée).
--
-- Garanties de la base :
--   • mouvement de trésorerie et facture : intangibles une fois enregistrés (correction par annulation motivée) ;
--   • une caisse ne peut jamais avoir un solde négatif ;
--   • numérotation continue des factures par entreprise et par année (FAC-AAAA-NNNNN) ;
--   • totaux de facture cohérents avec les lignes et le taux de TVA (contrôle à la validation de la transaction) ;
--   • écriture générée par une opération : non modifiable, non supprimable depuis la comptabilité.

---------------------------------------------------------------------------
-- Lien écriture ↔ opération d'origine
---------------------------------------------------------------------------

ALTER TABLE journal_entries
  ADD COLUMN source_type TEXT CHECK (source_type IN ('treasury_movement', 'invoice')),
  ADD COLUMN source_id UUID,
  ADD CONSTRAINT journal_entries_source CHECK ((source_type IS NULL) = (source_id IS NULL));
CREATE INDEX journal_entries_source_idx ON journal_entries (source_type, source_id);

CREATE FUNCTION journal_entries_source_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_type IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Écriture générée par une opération : elle ne se supprime pas. Annulez l''opération d''origine.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.journal_id, NEW.entry_date, NEW.piece_reference, NEW.label, NEW.fiscal_year_id, NEW.source_type, NEW.source_id)
     IS DISTINCT FROM (OLD.journal_id, OLD.entry_date, OLD.piece_reference, OLD.label, OLD.fiscal_year_id, OLD.source_type, OLD.source_id) THEN
    RAISE EXCEPTION 'Écriture générée par une opération : seule sa validation est possible. Corrigez l''opération d''origine.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entries_source_guard BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_source_guard();

---------------------------------------------------------------------------
-- Clients
---------------------------------------------------------------------------

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
    niu TEXT CHECK (niu IS NULL OR length(niu) <= 30),
    phone TEXT CHECK (phone IS NULL OR length(phone) <= 40),
    email TEXT CHECK (email IS NULL OR length(email) <= 254),
    address TEXT CHECK (address IS NULL OR length(address) <= 300),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, company_id)
);
CREATE INDEX customers_name ON customers (company_id, lower(name));

---------------------------------------------------------------------------
-- Comptes de trésorerie : caisses, banques, mobile money
---------------------------------------------------------------------------

CREATE TABLE treasury_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    kind TEXT NOT NULL CHECK (kind IN ('cash', 'bank', 'mobile')),
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
    account_id UUID NOT NULL,
    journal_id UUID NOT NULL,
    bank_name TEXT CHECK (bank_name IS NULL OR length(bank_name) <= 80),
    account_reference TEXT CHECK (account_reference IS NULL OR length(account_reference) <= 60),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, account_id),
    UNIQUE (company_id, name),
    UNIQUE (id, company_id),
    FOREIGN KEY (account_id, company_id) REFERENCES accounts(id, company_id),
    FOREIGN KEY (journal_id, company_id) REFERENCES journals(id, company_id)
);

-- Une caisse se rattache à un compte 57 ; une banque ou un compte de mobile money à un compte de classe 5
-- (52 par défaut ; le compte exact du mobile money est À VÉRIFIER avec l'expert-comptable).
CREATE FUNCTION treasury_accounts_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE num text;
BEGIN
  SELECT account_number INTO num FROM accounts WHERE id = NEW.account_id;
  IF NEW.kind = 'cash' AND num NOT LIKE '57%' THEN
    RAISE EXCEPTION 'Une caisse se rattache à un compte 57 (compte % refusé).', num USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind <> 'cash' AND num NOT LIKE '5%' THEN
    RAISE EXCEPTION 'Un compte de banque ou de mobile money se rattache à un compte de trésorerie (classe 5).' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.kind <> OLD.kind OR NEW.account_id <> OLD.account_id) THEN
    RAISE EXCEPTION 'Le type et le compte comptable d''un compte de trésorerie ne changent pas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER treasury_accounts_check BEFORE INSERT OR UPDATE ON treasury_accounts FOR EACH ROW EXECUTE FUNCTION treasury_accounts_check();

-- Caissiers attitrés : un utilisateur qui n'a que les droits « caisse » ne voit et n'utilise que ses caisses.
CREATE TABLE treasury_account_holders (
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    treasury_account_id UUID NOT NULL,
    user_id UUID NOT NULL,
    PRIMARY KEY (treasury_account_id, user_id),
    FOREIGN KEY (treasury_account_id, company_id) REFERENCES treasury_accounts(id, company_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, company_id) REFERENCES app_users(id, company_id)
);

---------------------------------------------------------------------------
-- Mouvements de trésorerie (intangibles)
---------------------------------------------------------------------------

CREATE TABLE treasury_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    treasury_account_id UUID NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    kind TEXT NOT NULL CHECK (kind IN ('receipt', 'expense', 'transfer', 'invoice_payment', 'reversal')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),     -- TVA récupérable incluse dans amount (dépenses)
    movement_date DATE NOT NULL,
    movement_year INTEGER NOT NULL,
    sequence_no INTEGER NOT NULL,
    reference TEXT NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 60),
    label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 200),
    category TEXT,
    counterpart_account_id UUID NOT NULL,
    tax_account_id UUID,
    invoice_id UUID,
    transfer_group UUID,
    reversal_of UUID,
    reason TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (tax_amount < amount),
    CHECK ((tax_amount = 0) = (tax_account_id IS NULL)),
    CHECK ((kind = 'reversal') = (reversal_of IS NOT NULL)),
    CHECK (reversal_of IS NULL OR length(btrim(coalesce(reason, ''))) >= 3),
    UNIQUE (company_id, treasury_account_id, movement_year, sequence_no),
    UNIQUE (id, company_id),
    FOREIGN KEY (treasury_account_id, company_id) REFERENCES treasury_accounts(id, company_id),
    FOREIGN KEY (counterpart_account_id, company_id) REFERENCES accounts(id, company_id),
    FOREIGN KEY (tax_account_id, company_id) REFERENCES accounts(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id),
    FOREIGN KEY (reversal_of, company_id) REFERENCES treasury_movements(id, company_id)
);
CREATE UNIQUE INDEX treasury_movements_single_reversal ON treasury_movements (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX treasury_movements_account_date ON treasury_movements (company_id, treasury_account_id, movement_date);

CREATE FUNCTION treasury_movements_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE k text; solde numeric;
BEGIN
  -- Numéro du mouvement : continu par compte de trésorerie et par année.
  PERFORM pg_advisory_xact_lock(hashtextextended('treasury:' || NEW.treasury_account_id::text, 0));
  NEW.movement_year := extract(year FROM NEW.movement_date)::integer;
  SELECT coalesce(max(sequence_no), 0) + 1 INTO NEW.sequence_no
    FROM treasury_movements WHERE treasury_account_id = NEW.treasury_account_id AND movement_year = NEW.movement_year;
  IF coalesce(btrim(NEW.reference), '') = '' THEN
    NEW.reference := 'MVT-' || NEW.movement_year || '-' || lpad(NEW.sequence_no::text, 5, '0');
  END IF;
  -- Une caisse ne descend jamais sous zéro (le verrou ci-dessus sérialise les sorties concurrentes).
  SELECT kind INTO k FROM treasury_accounts WHERE id = NEW.treasury_account_id;
  IF k = 'cash' AND NEW.direction = 'out' THEN
    SELECT coalesce(sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) INTO solde
      FROM treasury_movements WHERE treasury_account_id = NEW.treasury_account_id;
    IF solde < NEW.amount THEN
      RAISE EXCEPTION 'Solde de caisse insuffisant : % FCFA disponibles, % demandés.', solde, NEW.amount USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.reversal_of IS NOT NULL AND EXISTS (SELECT 1 FROM treasury_movements WHERE id = NEW.reversal_of AND kind = 'reversal') THEN
    RAISE EXCEPTION 'Une annulation ne s''annule pas.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER treasury_movements_before_insert BEFORE INSERT ON treasury_movements
  FOR EACH ROW EXECUTE FUNCTION treasury_movements_before_insert();
CREATE TRIGGER treasury_movements_append_only BEFORE UPDATE OR DELETE ON treasury_movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER treasury_movements_no_truncate BEFORE TRUNCATE ON treasury_movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

---------------------------------------------------------------------------
-- Factures (intangibles, numérotation continue)
---------------------------------------------------------------------------

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    invoice_year INTEGER NOT NULL,
    sequence_no INTEGER NOT NULL,
    number TEXT NOT NULL,
    invoice_date DATE NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('goods', 'services', 'mixed')),
    customer_id UUID,
    customer_name TEXT NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 2 AND 200),
    customer_niu TEXT,
    customer_address TEXT,
    customer_phone TEXT,
    seller JSONB NOT NULL,                       -- identité du vendeur figée à l'émission (raison sociale, NIU, RCCM…)
    currency CHAR(3) NOT NULL,
    tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),   -- taux en pour dix mille (19,25 % = 1925)
    total_ht BIGINT NOT NULL CHECK (total_ht >= 0),
    total_tax BIGINT NOT NULL CHECK (total_tax >= 0),
    total_ttc BIGINT NOT NULL CHECK (total_ttc > 0),
    payment_mode TEXT NOT NULL CHECK (payment_mode IN ('immediate', 'credit')),
    treasury_account_id UUID,
    notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (total_ttc = total_ht + total_tax),
    CHECK ((payment_mode = 'immediate') = (treasury_account_id IS NOT NULL)),
    UNIQUE (company_id, invoice_year, sequence_no),
    UNIQUE (company_id, number),
    UNIQUE (id, company_id),
    FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id),
    FOREIGN KEY (treasury_account_id, company_id) REFERENCES treasury_accounts(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);

CREATE TABLE invoice_lines (
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    invoice_id UUID NOT NULL,
    line_no SMALLINT NOT NULL CHECK (line_no > 0),
    description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
    amount BIGINT NOT NULL CHECK (amount >= 0),
    revenue_account_id UUID NOT NULL,
    PRIMARY KEY (invoice_id, line_no),
    -- Montant de ligne = quantité × prix unitaire, arrondi à l'unité (demi vers le haut).
    CHECK (amount = round(quantity * unit_price)),
    FOREIGN KEY (invoice_id, company_id) REFERENCES invoices(id, company_id),
    FOREIGN KEY (revenue_account_id, company_id) REFERENCES accounts(id, company_id)
);

ALTER TABLE treasury_movements
  ADD CONSTRAINT treasury_movements_invoice_fk FOREIGN KEY (invoice_id, company_id) REFERENCES invoices(id, company_id);

CREATE FUNCTION invoices_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('invoices:' || NEW.company_id::text, 0));
  NEW.invoice_year := extract(year FROM NEW.invoice_date)::integer;
  SELECT coalesce(max(sequence_no), 0) + 1 INTO NEW.sequence_no
    FROM invoices WHERE company_id = NEW.company_id AND invoice_year = NEW.invoice_year;
  NEW.number := 'FAC-' || NEW.invoice_year || '-' || lpad(NEW.sequence_no::text, 5, '0');
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_before_insert BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_before_insert();

-- Les lignes s'ajoutent seulement dans la transaction qui crée la facture.
CREATE FUNCTION invoice_lines_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND created_at = now()) THEN
    RAISE EXCEPTION 'Une facture émise ne se modifie pas.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_lines_before_insert BEFORE INSERT ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_before_insert();

-- Contrôle différé (fin de transaction) : total HT = somme des lignes ; TVA = HT × taux, arrondie.
CREATE FUNCTION invoices_check_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE inv invoices; somme numeric;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = NEW.id;
  SELECT coalesce(sum(amount), 0) INTO somme FROM invoice_lines WHERE invoice_id = NEW.id;
  IF somme <> inv.total_ht OR NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = NEW.id) THEN
    RAISE EXCEPTION 'Facture % incohérente : total HT % ≠ somme des lignes %.', inv.number, inv.total_ht, somme USING ERRCODE = 'check_violation';
  END IF;
  IF inv.total_tax <> (inv.total_ht * inv.tax_rate_bp + 5000) / 10000 THEN
    RAISE EXCEPTION 'Facture % incohérente : TVA % ≠ HT × taux.', inv.number, inv.total_tax USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invoices_check_totals AFTER INSERT ON invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoices_check_totals();

CREATE TRIGGER invoices_append_only BEFORE UPDATE OR DELETE ON invoices FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER invoice_lines_append_only BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON invoices FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

---------------------------------------------------------------------------
-- Isolation, droits, rôles
---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'treasury_accounts', 'treasury_account_holders', 'treasury_movements', 'invoices', 'invoice_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON customers, treasury_accounts TO gc_app;
GRANT SELECT, INSERT, DELETE ON treasury_account_holders TO gc_app;
GRANT SELECT, INSERT ON treasury_movements, invoices, invoice_lines TO gc_app;      -- ni UPDATE ni DELETE
GRANT SELECT ON customers, treasury_accounts, treasury_account_holders, treasury_movements, invoices, invoice_lines TO gc_backup;

-- Rôles système des entreprises existantes : ventes au comptant pour le caissier, administration de la
-- trésorerie et émission de factures pour le directeur financier (alignés sur roles-systeme.ts).
DO $$
DECLARE e record;
BEGIN
  FOR e IN SELECT id FROM companies LOOP
    PERFORM set_config('app.company_id', e.id::text, true);
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r JOIN permissions p ON
           (r.role_key = 'cashier' AND p.permission_key IN ('sales.read', 'sales.create', 'sales.print'))
        OR (r.role_key = 'finance_director' AND p.permission_key IN ('treasury.admin', 'sales.create'))
     WHERE r.is_system_role
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END $$;
