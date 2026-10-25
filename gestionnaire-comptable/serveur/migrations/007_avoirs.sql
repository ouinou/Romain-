-- 007 : avoirs (factures d'avoir) sur factures émises, et remboursement du client.
--
-- Une facture émise ne se modifie pas : pour l'annuler en tout ou en partie, on émet un AVOIR qui la cite.
-- Garanties de la base :
--   • numérotation continue des avoirs par entreprise et par année (AV-AAAA-NNNNN), séparée des factures ;
--   • un avoir reprend les lignes de SA facture, au même prix unitaire et au même taux de TVA ;
--   • on ne crédite jamais plus que ce qui a été facturé, ligne par ligne et au total (TVA comprise) ;
--   • quand une ligne (ou la facture) est entièrement créditée, les montants cumulés des avoirs égalent
--     exactement ceux de la facture : pas d'écart d'arrondi qui resterait dû ou remboursé ;
--   • un avoir est intangible, comme la facture.
--
-- Le remboursement éventuel est un mouvement de trésorerie de sortie (kind = 'credit_refund') rattaché à la
-- facture : le « payé » de la facture diminue d'autant. Reste dû = TTC − avoirs − règlements nets.

ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_source_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('treasury_movement', 'invoice', 'credit_note'));

CREATE TABLE credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    invoice_id UUID NOT NULL,
    credit_year INTEGER NOT NULL,
    sequence_no INTEGER NOT NULL,
    number TEXT NOT NULL,
    credit_date DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
    seller JSONB NOT NULL,                       -- identité du vendeur figée à l'émission de l'avoir
    currency CHAR(3) NOT NULL,
    tax_rate_bp INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
    total_ht BIGINT NOT NULL CHECK (total_ht >= 0),
    total_tax BIGINT NOT NULL CHECK (total_tax >= 0),
    total_ttc BIGINT NOT NULL CHECK (total_ttc > 0),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (total_ttc = total_ht + total_tax),
    UNIQUE (company_id, credit_year, sequence_no),
    UNIQUE (company_id, number),
    UNIQUE (id, company_id),
    FOREIGN KEY (invoice_id, company_id) REFERENCES invoices(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);
CREATE INDEX credit_notes_invoice ON credit_notes (invoice_id);

CREATE TABLE credit_note_lines (
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    credit_note_id UUID NOT NULL,
    line_no SMALLINT NOT NULL CHECK (line_no > 0),
    invoice_id UUID NOT NULL,
    invoice_line_no SMALLINT NOT NULL,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    amount BIGINT NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (credit_note_id, line_no),
    UNIQUE (credit_note_id, invoice_line_no),
    FOREIGN KEY (credit_note_id, company_id) REFERENCES credit_notes(id, company_id),
    FOREIGN KEY (invoice_id, invoice_line_no) REFERENCES invoice_lines(invoice_id, line_no)
);

ALTER TABLE treasury_movements DROP CONSTRAINT treasury_movements_kind_check;
ALTER TABLE treasury_movements ADD CONSTRAINT treasury_movements_kind_check
  CHECK (kind IN ('receipt', 'expense', 'transfer', 'invoice_payment', 'reversal', 'credit_refund'));
ALTER TABLE treasury_movements ADD COLUMN credit_note_id UUID;
ALTER TABLE treasury_movements
  ADD CONSTRAINT treasury_movements_credit_note_fk FOREIGN KEY (credit_note_id, company_id) REFERENCES credit_notes(id, company_id),
  ADD CONSTRAINT treasury_movements_refund CHECK (kind <> 'credit_refund' OR (direction = 'out' AND credit_note_id IS NOT NULL AND invoice_id IS NOT NULL));

CREATE FUNCTION credit_notes_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE inv invoices;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id;
  IF NEW.credit_date < inv.invoice_date THEN
    RAISE EXCEPTION 'Un avoir ne peut pas être antérieur à sa facture (%).', inv.number USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tax_rate_bp <> inv.tax_rate_bp OR NEW.currency <> inv.currency THEN
    RAISE EXCEPTION 'Un avoir reprend le taux de TVA et la devise de sa facture.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('credit_notes:' || NEW.company_id::text, 0));
  NEW.credit_year := extract(year FROM NEW.credit_date)::integer;
  SELECT coalesce(max(sequence_no), 0) + 1 INTO NEW.sequence_no
    FROM credit_notes WHERE company_id = NEW.company_id AND credit_year = NEW.credit_year;
  NEW.number := 'AV-' || NEW.credit_year || '-' || lpad(NEW.sequence_no::text, 5, '0');
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER credit_notes_before_insert BEFORE INSERT ON credit_notes FOR EACH ROW EXECUTE FUNCTION credit_notes_before_insert();

CREATE FUNCTION credit_note_lines_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM credit_notes WHERE id = NEW.credit_note_id AND invoice_id = NEW.invoice_id AND created_at = now()) THEN
    RAISE EXCEPTION 'Un avoir émis ne se modifie pas, et ses lignes viennent de sa propre facture.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_note_lines_before_insert BEFORE INSERT ON credit_note_lines FOR EACH ROW EXECUTE FUNCTION credit_note_lines_before_insert();

-- Contrôle différé (fin de transaction), sur l'avoir et sur le cumul des avoirs de la facture.
CREATE FUNCTION credit_notes_check_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cn credit_notes; inv invoices; somme numeric; l record; ht_cumul numeric; tva_cumul numeric; tout_credite boolean;
BEGIN
  SELECT * INTO cn FROM credit_notes WHERE id = NEW.id;
  SELECT * INTO inv FROM invoices WHERE id = cn.invoice_id;
  SELECT coalesce(sum(amount), 0) INTO somme FROM credit_note_lines WHERE credit_note_id = cn.id;
  IF somme <> cn.total_ht OR NOT EXISTS (SELECT 1 FROM credit_note_lines WHERE credit_note_id = cn.id) THEN
    RAISE EXCEPTION 'Avoir % incohérent : total HT % ≠ somme des lignes %.', cn.number, cn.total_ht, somme USING ERRCODE = 'check_violation';
  END IF;
  -- Ligne par ligne : quantité et montant cumulés ≤ facture ; montant = quantité × prix, sauf la ligne qui solde.
  FOR l IN
    SELECT il.line_no, il.quantity AS q_fact, il.amount AS m_fact, il.unit_price,
           cl.quantity AS q, cl.amount AS m,
           (SELECT sum(x.quantity) FROM credit_note_lines x WHERE x.invoice_id = il.invoice_id AND x.invoice_line_no = il.line_no) AS q_cumul,
           (SELECT sum(x.amount) FROM credit_note_lines x WHERE x.invoice_id = il.invoice_id AND x.invoice_line_no = il.line_no) AS m_cumul
      FROM credit_note_lines cl JOIN invoice_lines il ON il.invoice_id = cl.invoice_id AND il.line_no = cl.invoice_line_no
     WHERE cl.credit_note_id = cn.id
  LOOP
    IF l.q_cumul > l.q_fact OR l.m_cumul > l.m_fact THEN
      RAISE EXCEPTION 'Avoir % : la ligne % de la facture % serait créditée au-delà de ce qui a été facturé.', cn.number, l.line_no, inv.number USING ERRCODE = 'check_violation';
    END IF;
    IF l.q_cumul = l.q_fact THEN
      IF l.m_cumul <> l.m_fact THEN
        RAISE EXCEPTION 'Avoir % : la ligne % est entièrement créditée, son montant cumulé doit égaler celui de la facture.', cn.number, l.line_no USING ERRCODE = 'check_violation';
      END IF;
    ELSIF l.m <> round(l.q * l.unit_price) THEN
      RAISE EXCEPTION 'Avoir % : montant de la ligne % ≠ quantité × prix unitaire de la facture.', cn.number, l.line_no USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  -- TVA : HT × taux, sauf l'avoir qui solde toute la facture (il reprend exactement la TVA restante).
  SELECT coalesce(sum(total_ht), 0), coalesce(sum(total_tax), 0) INTO ht_cumul, tva_cumul FROM credit_notes WHERE invoice_id = inv.id;
  tout_credite := ht_cumul = inv.total_ht AND NOT EXISTS (
    SELECT 1 FROM invoice_lines il WHERE il.invoice_id = inv.id
       AND il.quantity > coalesce((SELECT sum(x.quantity) FROM credit_note_lines x WHERE x.invoice_id = il.invoice_id AND x.invoice_line_no = il.line_no), 0));
  IF tva_cumul > inv.total_tax OR ht_cumul > inv.total_ht THEN
    RAISE EXCEPTION 'Les avoirs de la facture % dépasseraient son montant.', inv.number USING ERRCODE = 'check_violation';
  END IF;
  IF tout_credite THEN
    IF tva_cumul <> inv.total_tax THEN
      RAISE EXCEPTION 'Facture % entièrement créditée : la TVA des avoirs doit égaler celle de la facture.', inv.number USING ERRCODE = 'check_violation';
    END IF;
  ELSIF cn.total_tax <> (cn.total_ht * cn.tax_rate_bp + 5000) / 10000 THEN
    RAISE EXCEPTION 'Avoir % incohérent : TVA % ≠ HT × taux.', cn.number, cn.total_tax USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER credit_notes_check_totals AFTER INSERT ON credit_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION credit_notes_check_totals();

CREATE TRIGGER credit_notes_append_only BEFORE UPDATE OR DELETE ON credit_notes FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER credit_note_lines_append_only BEFORE UPDATE OR DELETE ON credit_note_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER credit_notes_no_truncate BEFORE TRUNCATE ON credit_notes FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER credit_note_lines_no_truncate BEFORE TRUNCATE ON credit_note_lines FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_notes', 'credit_note_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON credit_notes, credit_note_lines TO gc_app;      -- ni UPDATE ni DELETE
GRANT SELECT ON credit_notes, credit_note_lines TO gc_backup;

-- Émettre un avoir = « Ventes : annuler » (sales.cancel). Accordé au directeur financier, pas au caissier :
-- un avoir avec remboursement fait sortir de l'argent (aligné sur roles-systeme.ts).
DO $$
DECLARE e record;
BEGIN
  FOR e IN SELECT id FROM companies LOOP
    PERFORM set_config('app.company_id', e.id::text, true);
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r JOIN permissions p ON r.role_key = 'finance_director' AND p.permission_key = 'sales.cancel'
     WHERE r.is_system_role
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.company_id', '', true);
END $$;
