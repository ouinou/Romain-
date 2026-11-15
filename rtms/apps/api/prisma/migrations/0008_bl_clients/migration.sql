-- =====================================================================
-- RTMS 0008 — Module « BL et douane » (suivi des BL jusqu'à la mainlevée).
-- 1. Le module « bl » est ajouté à la liste des modules autorisés.
-- 2. Droits par défaut du nouveau module pour les sociétés existantes
--    (mêmes valeurs que src/security/permissions.ts). Les droits déjà
--    personnalisés des autres modules ne sont pas touchés.
-- Aucune donnée existante n'est modifiée.
-- =====================================================================
ALTER TABLE records DROP CONSTRAINT records_module_chk;
ALTER TABLE records ADD CONSTRAINT records_module_chk CHECK (module IN (
  'transport','transit','importexport','commerce','clients','fleet','staff',
  'maintenance','invoices','finance','documents','bl'));

INSERT INTO role_permissions (company_id, role_key, module, action)
SELECT c.id, v.role_key, 'bl', v.action
  FROM companies c
 CROSS JOIN (VALUES
   ('admin','read'),('admin','create'),('admin','update'),('admin','validate'),('admin','cancel'),('admin','export'),('admin','print'),('admin','admin'),
   ('direction','read'),('direction','export'),('direction','print'),
   ('transit','read'),('transit','create'),('transit','update'),('transit','validate'),('transit','cancel'),('transit','export'),('transit','print'),
   ('importexport','read'),('importexport','create'),('importexport','update'),('importexport','validate'),('importexport','cancel'),('importexport','export'),('importexport','print'),
   ('finance','read'),('finance','export'),('finance','print'),
   ('transport','read'),
   ('agent','read'),('agent','create'),('agent','update')
 ) AS v(role_key, action)
ON CONFLICT DO NOTHING;
