-- 005 : socle de FINEXA PHARMA : permissions de la pharmacie, catalogue, lots, mouvements de stock, inventaires.
--
-- Principes (repris de FINEXA ERP) :
--  - chaque table est isolée par officine (company_id, sécurité au niveau des lignes) ;
--  - les mouvements de stock et l'historique des prix sont en AJOUT SEUL : on corrige par un mouvement inverse ;
--  - le stock d'un lot est la somme de ses mouvements ; la base refuse tout mouvement qui le rendrait négatif.

---------------------------------------------------------------------------
-- Permissions : modules de la pharmacie (la grille module × action vient de la migration 002)
---------------------------------------------------------------------------
DELETE FROM permissions WHERE module_key IN ('accounting', 'treasury', 'hr', 'payroll');
DELETE FROM permission_modules WHERE module_key IN ('accounting', 'treasury', 'hr', 'payroll');
UPDATE permission_modules SET label = 'Paramètres de la pharmacie' WHERE module_key = 'company';
UPDATE permission_modules SET label = 'Ventes et clients', sort_order = 90 WHERE module_key = 'sales';
UPDATE permission_modules SET label = 'Rapports et statistiques' WHERE module_key = 'reports';
UPDATE permission_modules SET label = 'Stock, lots et inventaires' WHERE module_key = 'stock';
INSERT INTO permission_modules (module_key, label, sort_order) VALUES ('catalog', 'Catalogue des produits', 55);
INSERT INTO permissions (permission_key, description, module_key, action_key)
SELECT 'catalog.' || a.action_key, 'Catalogue des produits : ' || lower(a.label), 'catalog', a.action_key FROM permission_actions a;
UPDATE permissions p SET description = m.label || ' : ' || lower(a.label)
  FROM permission_modules m, permission_actions a WHERE p.module_key = m.module_key AND p.action_key = a.action_key;

---------------------------------------------------------------------------
-- Référentiels
---------------------------------------------------------------------------
-- Catégories sur deux niveaux : catégorie (parent_id NULL) › famille.
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    parent_id UUID,
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, company_id),
    FOREIGN KEY (parent_id, company_id) REFERENCES categories(id, company_id)
);
CREATE UNIQUE INDEX categories_nom_unique ON categories (company_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
CREATE FUNCTION categories_deux_niveaux() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Une famille se range sous une catégorie, pas sous une autre famille.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER categories_deux_niveaux BEFORE INSERT OR UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION categories_deux_niveaux();

CREATE TABLE dosage_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
    archived_at TIMESTAMPTZ,
    UNIQUE (id, company_id)
);
CREATE UNIQUE INDEX dosage_forms_nom_unique ON dosage_forms (company_id, lower(btrim(name)));

CREATE TABLE storage_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
    kind TEXT NOT NULL DEFAULT 'shelf' CHECK (kind IN ('shelf', 'reserve', 'cold', 'other')),
    archived_at TIMESTAMPTZ,
    UNIQUE (id, company_id)
);
CREATE UNIQUE INDEX storage_locations_nom_unique ON storage_locations (company_id, lower(btrim(name)));

---------------------------------------------------------------------------
-- Catalogue
---------------------------------------------------------------------------
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    internal_code TEXT NOT NULL,                          -- P-00001, attribué par la base
    sequence_no INTEGER NOT NULL,
    barcode TEXT CHECK (barcode IS NULL OR barcode ~ '^[0-9A-Za-z-]{4,32}$'),
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
    dci TEXT CHECK (dci IS NULL OR length(btrim(dci)) BETWEEN 2 AND 160),   -- dénomination commune internationale
    category_id UUID,
    form_id UUID,
    dosage TEXT CHECK (dosage IS NULL OR length(dosage) <= 60),
    presentation TEXT CHECK (presentation IS NULL OR length(presentation) <= 120),
    manufacturer TEXT CHECK (manufacturer IS NULL OR length(manufacturer) <= 120),
    usual_supplier TEXT CHECK (usual_supplier IS NULL OR length(usual_supplier) <= 120),   -- remplacé par la fiche fournisseur au lot « achats »
    purchase_price BIGINT NOT NULL DEFAULT 0 CHECK (purchase_price BETWEEN 0 AND 1000000000),
    sale_price BIGINT NOT NULL CHECK (sale_price BETWEEN 0 AND 1000000000),
    tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),   -- choisi parmi les taux saisis par la pharmacie
    alert_threshold INTEGER NOT NULL DEFAULT 0 CHECK (alert_threshold BETWEEN 0 AND 1000000),
    storage_conditions TEXT CHECK (storage_conditions IS NULL OR length(storage_conditions) <= 120),
    dispensing_category TEXT CHECK (dispensing_category IS NULL OR length(dispensing_category) <= 80),   -- informatif, saisi par la pharmacie
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, company_id),
    UNIQUE (company_id, sequence_no),
    UNIQUE (company_id, internal_code),
    FOREIGN KEY (category_id, company_id) REFERENCES categories(id, company_id),
    FOREIGN KEY (form_id, company_id) REFERENCES dosage_forms(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);
CREATE UNIQUE INDEX products_barcode_unique ON products (company_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_recherche ON products (company_id, lower(name));
CREATE FUNCTION products_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('products:' || NEW.company_id::text, 0));
  SELECT coalesce(max(sequence_no), 0) + 1 INTO NEW.sequence_no FROM products WHERE company_id = NEW.company_id;
  NEW.internal_code := 'P-' || lpad(NEW.sequence_no::text, 5, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER products_before_insert BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION products_before_insert();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Historique des prix (ajout seul) : une ligne à la création puis à chaque changement de prix.
CREATE TABLE product_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    product_id UUID NOT NULL,
    purchase_price BIGINT NOT NULL,
    sale_price BIGINT NOT NULL,
    tax_rate_bp INTEGER NOT NULL,
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (product_id, company_id) REFERENCES products(id, company_id),
    FOREIGN KEY (changed_by, company_id) REFERENCES app_users(id, company_id)
);
CREATE TRIGGER product_price_history_append_only BEFORE UPDATE OR DELETE ON product_price_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER product_price_history_no_truncate BEFORE TRUNCATE ON product_price_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

---------------------------------------------------------------------------
-- Lots
---------------------------------------------------------------------------
CREATE TABLE lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    product_id UUID NOT NULL,
    lot_number TEXT NOT NULL CHECK (length(btrim(lot_number)) BETWEEN 1 AND 40),
    expiry_date DATE NOT NULL,
    supplier_name TEXT CHECK (supplier_name IS NULL OR length(supplier_name) <= 120),
    received_on DATE NOT NULL,
    purchase_price BIGINT NOT NULL CHECK (purchase_price BETWEEN 0 AND 1000000000),
    location_id UUID,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'blocked', 'recalled')),
    status_reason TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status = 'available' OR length(btrim(coalesce(status_reason, ''))) >= 3),
    UNIQUE (id, company_id),
    FOREIGN KEY (product_id, company_id) REFERENCES products(id, company_id),
    FOREIGN KEY (location_id, company_id) REFERENCES storage_locations(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);
-- Un numéro de lot n'existe qu'une fois par produit.
CREATE UNIQUE INDEX lots_numero_unique ON lots (company_id, product_id, upper(btrim(lot_number)));
CREATE INDEX lots_peremption ON lots (company_id, expiry_date);

---------------------------------------------------------------------------
-- Inventaires
---------------------------------------------------------------------------
CREATE TABLE inventories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    number TEXT NOT NULL,
    year INTEGER NOT NULL,
    sequence_no INTEGER NOT NULL,
    label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 120),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'validated', 'cancelled')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by UUID,
    closed_at TIMESTAMPTZ,
    UNIQUE (id, company_id),
    UNIQUE (company_id, year, sequence_no),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id),
    FOREIGN KEY (closed_by, company_id) REFERENCES app_users(id, company_id)
);
CREATE FUNCTION inventories_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventories:' || NEW.company_id::text, 0));
  NEW.year := extract(year FROM now())::integer;
  SELECT coalesce(max(sequence_no), 0) + 1 INTO NEW.sequence_no FROM inventories WHERE company_id = NEW.company_id AND year = NEW.year;
  NEW.number := 'INV-' || NEW.year || '-' || lpad(NEW.sequence_no::text, 3, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER inventories_before_insert BEFORE INSERT ON inventories FOR EACH ROW EXECUTE FUNCTION inventories_before_insert();

CREATE TABLE inventory_lines (
    inventory_id UUID NOT NULL,
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    lot_id UUID NOT NULL,
    expected INTEGER NOT NULL,          -- stock théorique au moment du comptage
    counted INTEGER CHECK (counted IS NULL OR counted >= 0),
    PRIMARY KEY (inventory_id, lot_id),
    FOREIGN KEY (inventory_id, company_id) REFERENCES inventories(id, company_id),
    FOREIGN KEY (lot_id, company_id) REFERENCES lots(id, company_id)
);
-- Un inventaire validé ou annulé est figé.
CREATE FUNCTION inventory_lines_figees() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM inventories WHERE id = coalesce(NEW.inventory_id, OLD.inventory_id)) <> 'open' THEN
    RAISE EXCEPTION 'Cet inventaire est clos : ses lignes ne se modifient plus.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER inventory_lines_figees BEFORE INSERT OR UPDATE OR DELETE ON inventory_lines FOR EACH ROW EXECUTE FUNCTION inventory_lines_figees();

---------------------------------------------------------------------------
-- Mouvements de stock (intangibles)
---------------------------------------------------------------------------
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL DEFAULT current_company_id() REFERENCES companies(id),
    number TEXT NOT NULL,
    year INTEGER NOT NULL,
    sequence_no INTEGER NOT NULL,
    lot_id UUID NOT NULL,
    product_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('initial', 'receipt', 'sale', 'customer_return', 'supplier_return', 'adjustment', 'breakage', 'expiry', 'inventory')),
    quantity INTEGER NOT NULL CHECK (quantity <> 0),        -- positive : entrée ; négative : sortie
    reason TEXT CHECK (reason IS NULL OR length(reason) <= 300),
    inventory_id UUID,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Sens imposé par la nature ; un ajustement ou un inventaire peut aller dans les deux sens, toujours motivé.
    CHECK (kind NOT IN ('initial', 'receipt', 'customer_return') OR quantity > 0),
    CHECK (kind NOT IN ('sale', 'supplier_return', 'breakage', 'expiry') OR quantity < 0),
    CHECK (kind NOT IN ('adjustment', 'breakage', 'expiry') OR length(btrim(coalesce(reason, ''))) >= 3),
    CHECK ((kind = 'inventory') = (inventory_id IS NOT NULL)),
    UNIQUE (id, company_id),
    UNIQUE (company_id, year, sequence_no),
    FOREIGN KEY (lot_id, company_id) REFERENCES lots(id, company_id),
    FOREIGN KEY (product_id, company_id) REFERENCES products(id, company_id),
    FOREIGN KEY (inventory_id, company_id) REFERENCES inventories(id, company_id),
    FOREIGN KEY (created_by, company_id) REFERENCES app_users(id, company_id)
);
CREATE INDEX stock_movements_lot ON stock_movements (lot_id);
CREATE INDEX stock_movements_date ON stock_movements (company_id, created_at);

CREATE FUNCTION stock_movements_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE dispo bigint; numero text; prod uuid;
BEGIN
  -- Le produit est celui du lot (pas de mouvement incohérent).
  SELECT product_id, lot_number INTO prod, numero FROM lots WHERE id = NEW.lot_id;
  IF prod IS DISTINCT FROM NEW.product_id THEN
    RAISE EXCEPTION 'Le lot ne correspond pas au produit.' USING ERRCODE = 'check_violation';
  END IF;
  -- Verrou par lot : deux postes ne peuvent pas sortir en même temps la dernière boîte.
  PERFORM pg_advisory_xact_lock(hashtextextended('lot:' || NEW.lot_id::text, 0));
  IF NEW.quantity < 0 THEN
    SELECT coalesce(sum(quantity), 0) INTO dispo FROM stock_movements WHERE lot_id = NEW.lot_id;
    IF dispo + NEW.quantity < 0 THEN
      RAISE EXCEPTION 'Stock insuffisant pour le lot % : % disponible(s), % demandé(s).', numero, dispo, -NEW.quantity USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Numéro continu par officine et par année.
  PERFORM pg_advisory_xact_lock(hashtextextended('mvt:' || NEW.company_id::text, 0));
  NEW.year := extract(year FROM now())::integer;
  SELECT coalesce(max(sequence_no), 0) + 1 INTO NEW.sequence_no FROM stock_movements WHERE company_id = NEW.company_id AND year = NEW.year;
  NEW.number := 'MVT-' || NEW.year || '-' || lpad(NEW.sequence_no::text, 5, '0');
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_before_insert BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movements_before_insert();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- Stock par lot (somme des mouvements). security_invoker : la vue respecte l'isolation des officines.
CREATE VIEW lot_stock WITH (security_invoker = true) AS
  SELECT l.id AS lot_id, l.company_id, l.product_id, coalesce(sum(m.quantity), 0)::bigint AS quantity
    FROM lots l LEFT JOIN stock_movements m ON m.lot_id = l.id GROUP BY l.id, l.company_id, l.product_id;

---------------------------------------------------------------------------
-- Isolation et droits SQL
---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'dosage_forms', 'storage_locations', 'products', 'product_price_history', 'lots', 'inventories', 'inventory_lines', 'stock_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON categories, dosage_forms, storage_locations, products, inventories TO gc_app;
-- Un lot enregistré ne change plus de numéro, de péremption ni de prix : seuls son statut et son emplacement évoluent.
GRANT SELECT, INSERT ON lots TO gc_app;
GRANT UPDATE (status, status_reason, location_id) ON lots TO gc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_lines TO gc_app;
GRANT SELECT, INSERT ON product_price_history, stock_movements TO gc_app;      -- ni UPDATE ni DELETE
GRANT SELECT ON lot_stock TO gc_app;
GRANT SELECT ON categories, dosage_forms, storage_locations, products, product_price_history, lots, inventories, inventory_lines, stock_movements, lot_stock TO gc_backup;
