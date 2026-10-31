import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { addUser, APP_DB, Client, invoice, mission, newCompany, owner, startApp } from './helpers.js';

let env: Awaited<ReturnType<typeof startApp>>;
const appDb = new PrismaClient({ datasources: { db: { url: APP_DB } } });
beforeAll(async () => { env = await startApp(); await env.ctx.redis.flushdb(); });
afterAll(async () => { await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect(); await appDb.$disconnect(); });

async function adminOf() {
  const co = await newCompany();
  const c = new Client(env.app);
  await c.login(co.email);
  return { ...co, c };
}

describe('Isolation stricte des sociétés (RLS PostgreSQL)', () => {
  it('une société ne voit jamais les données d’une autre, même sans filtre applicatif', async () => {
    const A = await adminOf();
    const B = await adminOf();
    expect((await A.c.post('/api/records/transport', mission('A-001'))).status).toBe(201);
    expect((await B.c.get('/api/records/transport')).body.total).toBe(0);

    // Requête brute du rôle applicatif : sans contexte → rien ; avec le contexte B → rien de A
    const none = await appDb.$queryRawUnsafe<unknown[]>('SELECT * FROM records');
    expect(none).toHaveLength(0);
    const asB = await appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.company_id', '${B.company.id}', true)`);
      return tx.$queryRawUnsafe<{ company_id: string }[]>('SELECT company_id FROM records');
    });
    expect(asB.every((r) => r.company_id === B.company.id)).toBe(true);

    // Écriture pour le compte d'une autre société : refusée par la base
    await expect(appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.company_id', '${B.company.id}', true)`);
      await tx.$executeRawUnsafe(`INSERT INTO records (id, company_id, module, data, created_by) VALUES (gen_random_uuid(), '${A.company.id}', 'transport', '{}', '${A.admin.id}')`);
    })).rejects.toThrow(/row-level security/);
  });

  it('le rôle applicatif ne peut ni supprimer ni lire les tables de licences', async () => {
    await expect(appDb.$executeRawUnsafe('DELETE FROM records')).rejects.toThrow(/permission denied/);
    await expect(appDb.$queryRawUnsafe('SELECT * FROM licenses')).rejects.toThrow(/permission denied/);
    await expect(appDb.$executeRawUnsafe('UPDATE audit_log SET action = action')).rejects.toThrow(/permission denied/);
  });
});

describe('Contrôle d’accès par rôle (serveur)', () => {
  it('agent : crée une mission, mais ne peut ni annuler, ni exporter, ni voir les factures', async () => {
    const A = await adminOf();
    const agent = new Client(env.app);
    await agent.login(await addUser(A.company.id, 'agent'));
    const m = await agent.post('/api/records/transport', mission('AG-1'));
    expect(m.status).toBe(201);
    expect((await agent.post(`/api/records/transport/${m.body.id}/cancel`, {})).status).toBe(403);
    expect((await agent.get('/api/records/transport/export.csv')).status).toBe(403);
    expect((await agent.get('/api/records/invoices')).status).toBe(403);
    expect((await agent.get('/api/admin/users')).status).toBe(403);
    expect((await agent.put('/api/admin/settings', { name: 'Pirate' })).status).toBe(403);
  });

  it('commercial : ne peut pas valider une facture ni modifier une facture validée', async () => {
    const A = await adminOf();
    const com = new Client(env.app);
    await com.login(await addUser(A.company.id, 'commercial'));
    expect((await com.post('/api/records/invoices', invoice('F-V1', { Statut: 'Validée' }))).status).toBe(403);
    const draft = await com.post('/api/records/invoices', invoice('F-D1'));
    expect(draft.status).toBe(201);
    expect((await com.patch(`/api/records/invoices/${draft.body.id}`, { version: 1, data: { Statut: 'Validée' } })).status).toBe(403);
    // L'administrateur valide ; ensuite le commercial ne peut plus modifier
    const v = await A.c.patch(`/api/records/invoices/${draft.body.id}`, { version: 1, data: { Statut: 'Validée' } });
    expect(v.status).toBe(200);
    expect((await com.patch(`/api/records/invoices/${draft.body.id}`, { version: 2, data: { 'Quantité': 99 } })).status).toBe(403);
  });

  it('les permissions modifiées par l’administrateur prennent effet immédiatement', async () => {
    const A = await adminOf();
    const stock = new Client(env.app);
    await stock.login(await addUser(A.company.id, 'stock'));
    expect((await stock.get('/api/records/fleet')).status).toBe(403);
    expect((await A.c.put('/api/admin/permissions/stock', { grants: ['dashboard:read', 'commerce:read', 'fleet:read'] })).status).toBe(200);
    expect((await stock.get('/api/records/fleet')).status).toBe(200);
    expect((await A.c.put('/api/admin/permissions/admin', { grants: [] })).status).toBe(400);
  });
});

describe('Enregistrements métier', () => {
  it('facture : total TTC calculé par le serveur, référence unique', async () => {
    const A = await adminOf();
    const r = await A.c.post('/api/records/invoices', invoice('F-2026-001'));
    expect(r.status).toBe(201);
    expect(r.body.computed).toEqual({ totalHT: 500000, tax: 90000, totalTTC: 590000 });
    const dup = await A.c.post('/api/records/invoices', invoice('f-2026-001'));
    expect(dup.status).toBe(409);
  });

  it('validation serveur : champ inconnu, statut libre et texte vide refusés', async () => {
    const A = await adminOf();
    expect((await A.c.post('/api/records/transport', mission('X', { role: 'admin' }))).status).toBe(400);
    expect((await A.c.post('/api/records/transport', mission('X', { Statut: 'nimporte' }))).status).toBe(400);
    const r = await A.c.post('/api/records/transport', mission('', {}));
    expect(r.status).toBe(400);
    expect(r.body.details.join(' ')).toMatch(/obligatoire/);
  });

  it('verrou optimiste : deux utilisateurs ne s’écrasent pas', async () => {
    const A = await adminOf();
    const r = await A.c.post('/api/records/transport', mission('OPT-1'));
    const first = await A.c.patch(`/api/records/transport/${r.body.id}`, { version: 1, data: { Marchandise: 'Riz' } });
    expect(first.status).toBe(200);
    const stale = await A.c.patch(`/api/records/transport/${r.body.id}`, { version: 1, data: { Marchandise: 'Sucre' } });
    expect(stale.status).toBe(409);
  });

  it('« Supprimer » annule l’enregistrement visé (et lui seul) sans destruction', async () => {
    const A = await adminOf();
    const ids: string[] = [];
    for (const ref of ['S-1', 'S-2', 'S-3']) ids.push((await A.c.post('/api/records/transport', mission(ref, { Marchandise: ref === 'S-2' ? 'Coton' : 'Ciment' }))).body.id);
    // Recherche filtrée puis suppression : c'est bien S-2 qui disparaît (bogue du prototype corrigé)
    const found = await A.c.get('/api/records/transport?q=coton');
    expect(found.body.items.map((x: { reference: string }) => x.reference)).toEqual(['S-2']);
    expect((await A.c.post(`/api/records/transport/${found.body.items[0].id}/cancel`, { reason: 'Doublon' })).status).toBe(200);
    const left = await A.c.get('/api/records/transport');
    expect(left.body.items.map((x: { reference: string }) => x.reference).sort()).toEqual(['S-1', 'S-3']);
    const row = await owner.record.findUniqueOrThrow({ where: { id: ids[1] } });
    expect(row.cancelledAt).not.toBeNull();
    expect(row.cancelReason).toBe('Doublon');
    // Un enregistrement annulé est figé
    expect((await A.c.patch(`/api/records/transport/${ids[1]}`, { version: row.version, data: { Marchandise: 'x' } })).status).toBe(404);
  });

  it('la recherche porte sur les valeurs, pas sur les noms de champs', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/transport', mission('Q-1'));
    expect((await A.c.get('/api/records/transport?q=marchandise')).body.total).toBe(0);
    expect((await A.c.get('/api/records/transport?q=moundou')).body.total).toBe(1);
    expect((await A.c.get(`/api/records/transport?q=${encodeURIComponent("%' OR 1=1 --")}`)).body.total).toBe(0);
  });

  it('champ sensible chiffré en base, lisible via l’API', async () => {
    const A = await adminOf();
    const r = await A.c.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'SOTRAC', 'N° contribuable': 'NIF-998877' } });
    expect(r.body.data['N° contribuable']).toBe('NIF-998877');
    const raw = await owner.record.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(JSON.stringify(raw.data)).not.toContain('NIF-998877');
    expect((raw.data as Record<string, string>)['N° contribuable']).toMatch(/^enc:/);
  });

  it('export CSV : droits, anti-injection de formules, traçabilité', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': '=cmd|"/c calc"!A1' } });
    const r = await A.c.get('/api/records/clients/export.csv');
    expect(r.status).toBe(200);
    expect(r.raw).toContain(`"'=cmd|""/c calc""!A1"`);
    const logs = await A.c.get('/api/admin/audit');
    expect(logs.body.some((l: { action: string }) => l.action === 'record.export')).toBe(true);
  });

  it('tableau de bord : compteurs mis en cache et rafraîchis après écriture', async () => {
    const A = await adminOf();
    expect((await A.c.get('/api/dashboard')).body.counts.transport ?? 0).toBe(0);
    await A.c.post('/api/records/transport', mission('D-1'));
    await A.c.post('/api/records/finance', { data: { 'Type (Recette/Dépense)': 'Recette', 'Libellé': 'Transport', 'Montant (FCFA)': '300000', 'Date': '2026-10-30' } });
    await A.c.post('/api/records/finance', { data: { 'Type (Recette/Dépense)': 'Dépense', 'Libellé': 'Gasoil', 'Montant (FCFA)': '120000', 'Date': '2026-10-30' } });
    const d = await A.c.get('/api/dashboard');
    expect(d.body.counts.transport).toBe(1);
    expect(d.body.finance).toEqual({ recettes: 300000, depenses: 120000, solde: 180000 });
  });

  it('les montants du tableau de bord sont masqués aux profils sans accès finance', async () => {
    const A = await adminOf();
    const agent = new Client(env.app);
    await agent.login(await addUser(A.company.id, 'agent'));
    expect((await agent.get('/api/dashboard')).body.finance).toBeNull();
  });

  it('paramètres société enregistrés et tracés', async () => {
    const A = await adminOf();
    const r = await A.c.put('/api/admin/settings', { name: 'RAHA TRANSPORT', phone: '+235 66 00 00 00', email: 'contact@raha.td', address: "N'Djamena", currency: 'FCFA', language: 'Français' });
    expect(r.status).toBe(200);
    expect((await A.c.get('/api/admin/settings')).body.phone).toBe('+235 66 00 00 00');
  });

  it('migration des données du prototype (localStorage) sans perte', async () => {
    const A = await adminOf();
    const legacy = {
      transport: [
        { 'Référence mission': 'M-OLD-1', Client: 'Ancien client', 'Départ': 'Abéché', Destination: 'Sarh', Marchandise: 'Mil', 'Véhicule': 'TC-1', Chauffeur: 'Ali', 'Date de départ': '2026-09-01', Statut: 'en route' },
        { 'Référence mission': 'M-OLD-1', Client: 'Doublon', 'Départ': 'a', Destination: 'b', Statut: 'En cours' },
      ],
      inconnu: [{ a: 1 }],
    };
    const dry = await A.c.post('/api/admin/import-legacy', { data: legacy, dryRun: true });
    expect(dry.body.report[0]).toMatchObject({ imported: 1, skipped: 1 });
    expect((await A.c.get('/api/records/transport')).body.total).toBe(0);
    const real = await A.c.post('/api/admin/import-legacy', { data: legacy });
    expect(real.body.report[0].warnings.join(' ')).toMatch(/à vérifier/);
    const list = await A.c.get('/api/records/transport');
    expect(list.body.items[0].data.Statut).toBe('en route'); // valeur d'origine conservée
  });
});

describe('Journal d’audit inviolable', () => {
  it('chaque opération est tracée et la chaîne est intègre', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/fleet', { data: { Immatriculation: 'TD-123-AB', 'Marque / modèle': 'Renault K', Statut: 'Disponible' } });
    const logs = await A.c.get('/api/admin/audit');
    expect(logs.body.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['record.create', 'auth.mfa_enabled', 'company.created']));
    expect((await A.c.get('/api/admin/audit/verify')).body).toEqual({ intact: true, firstBrokenId: null });
  });

  it('même le propriétaire de la base ne peut ni modifier ni vider le journal', async () => {
    await expect(owner.$executeRawUnsafe(`UPDATE audit_log SET action = 'x' WHERE id = (SELECT min(id) FROM audit_log)`)).rejects.toThrow(/ajout seul/);
    await expect(owner.$executeRawUnsafe('DELETE FROM audit_log')).rejects.toThrow(/ajout seul/);
    await expect(owner.$executeRawUnsafe('TRUNCATE audit_log')).rejects.toThrow(/ajout seul/);
  });

  it('une altération directe (superutilisateur) est détectée par la vérification', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/transport', mission('T-1'));
    const sql = `ALTER TABLE audit_log DISABLE TRIGGER audit_immutable_trg; UPDATE audit_log SET after = '{"falsifie":true}' WHERE company_id = '${A.company.id}' AND action = 'record.create'; ALTER TABLE audit_log ENABLE TRIGGER audit_immutable_trg;`;
    // Superutilisateur : URL fournie en CI, sinon compte système local « postgres »
    const su = process.env.TEST_SUPERUSER_DATABASE_URL;
    execSync(su ? `psql -q "${su}"` : `su postgres -c "psql -q -d rtms_test"`, { input: sql });
    const v = await A.c.get('/api/admin/audit/verify');
    expect(v.body.intact).toBe(false);
    expect(v.body.firstBrokenId).not.toBeNull();
  });
});

describe('Gestion des erreurs', () => {
  it('aucun détail technique ne fuit', async () => {
    const A = await adminOf();
    const r = await A.c.req('POST', '/api/records/transport', '{"data": ', { 'content-type': 'application/json' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/prisma|stack|node_modules|SELECT/i);
    expect((await A.c.get('/api/records/inexistant')).status).toBe(404);
  });
});

describe('Chaîne d’audit sous concurrence (régression 0003)', () => {
  it('60 créations simultanées dans la même société : chaîne intacte', async () => {
    const A = await adminOf();
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => A.c.post('/api/records/transport', mission(`CONC-${i}`))));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await A.c.get('/api/admin/audit/verify')).body).toEqual({ intact: true, firstBrokenId: null });
  });
});

describe('Chaîne d’audit : identifiant attribué sous verrou (régression 0003)', () => {
  it('un id imposé « dans le passé » ne casse pas l’ordre de chaînage', async () => {
    const A = await adminOf();
    // Simule de façon déterministe la course : une ligne arrive avec un id inférieur
    // aux lignes déjà chaînées. Avant 0003, audit_verify() signalait une rupture.
    await owner.$executeRawUnsafe(`INSERT INTO audit_log (id, company_id, action, entity) VALUES (-${Date.now()}, '${A.company.id}', 'test.course', 'test')`);
    await A.c.post('/api/records/transport', mission('ORD-1'));
    expect((await A.c.get('/api/admin/audit/verify')).body).toEqual({ intact: true, firstBrokenId: null });
  });
});
