-- 008 : profil d'entreprise complet et reçus de trésorerie.
--
-- Aucune donnée existante n'est modifiée : les nouveaux champs du profil vivent dans companies.settings.profil
-- (déjà présent), et l'identité prête à imprimer dans companies.settings.identiteDocument (calculée par le serveur).
-- Seule la table des mouvements reçoit une colonne, vide pour les mouvements déjà enregistrés.

-- Identité de l'entreprise figée sur chaque mouvement de trésorerie, comme sur les factures et les avoirs :
-- un reçu réimprimé plus tard garde le nom, les coordonnées et le logo du jour de l'opération.
ALTER TABLE treasury_movements ADD COLUMN issuer JSONB;

CREATE FUNCTION treasury_movements_issuer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issuer IS NULL THEN
    -- Identité calculée par le serveur ; à défaut (profil jamais modifié depuis la version 0.3), les champs de base.
    SELECT coalesce(c.settings->'identiteDocument', jsonb_strip_nulls(jsonb_build_object(
             'raisonSociale', c.legal_name, 'adresse', c.address, 'telephone', c.phone, 'niu', c.niu, 'rccm', c.rccm,
             'email', c.settings->'profil'->'email', 'regimeFiscal', c.settings->'profil'->'regimeFiscal', 'patente', c.settings->'profil'->'patente',
             'logoId', c.settings->'profil'->'logoId', 'couleurs', c.settings->'profil'->'couleurs', 'devise', c.currency_code)))
      INTO NEW.issuer FROM companies c WHERE c.id = NEW.company_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER treasury_movements_issuer BEFORE INSERT ON treasury_movements
  FOR EACH ROW EXECUTE FUNCTION treasury_movements_issuer();
