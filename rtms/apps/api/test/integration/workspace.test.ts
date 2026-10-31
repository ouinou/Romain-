import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addUser, Client, invoice, mission, newCompany, owner, startApp } from './helpers.js';

let env: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { env = await startApp(); await env.ctx.redis.flushdb(); });
afterAll(async () => { await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect(); });

async function adminOf() {
  const co = await newCompany();
  const c = new Client(env.app);
  await c.login(co.email);
  return { ...co, c };
}
const f = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const refs = (r: { body: { items: { reference: string }[] } }) => r.body.items.map((x) => x.reference);

describe('Tri et filtres multicritères', () => {
  it('trie sur un champ métier numérique, une date ou une colonne technique', async () => {
    const A = await adminOf();
    for (const [n, q] of [['F-1', '3'], ['F-2', '10'], ['F-3', '1']]) await A.c.post('/api/records/invoices', invoice(n, { 'Quantité': q }));
    expect(refs(await A.c.get(`/api/records/invoices?sort=${encodeURIComponent('Quantité')}&dir=asc`))).toEqual(['F-3', 'F-1', 'F-2']);
    expect(refs(await A.c.get('/api/records/invoices?sort=totalTTC&dir=desc'))).toEqual(['F-2', 'F-1', 'F-3']);
    expect(refs(await A.c.get('/api/records/invoices?sort=reference&dir=asc'))).toEqual(['F-1', 'F-2', 'F-3']);
  });

  it('filtre par liste, texte et plage de dates ; refuse un champ inconnu ou sensible', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/transport', mission('T-1', { Statut: 'En cours', 'Date de départ': '2026-10-01' }));
    await A.c.post('/api/records/transport', mission('T-2', { Statut: 'Clôturé', 'Date de départ': '2026-10-15', Client: 'SONASUT' }));
    await A.c.post('/api/records/transport', mission('T-3', { Statut: 'En cours', 'Date de départ': '2026-11-02', Client: 'Sonasut SA' }));
    expect(refs(await A.c.get(`/api/records/transport?f=${f({ Statut: 'En cours' })}&sort=reference&dir=asc`))).toEqual(['T-1', 'T-3']);
    expect(refs(await A.c.get(`/api/records/transport?f=${f({ Client: 'sonasut', Statut: 'En cours' })}`))).toEqual(['T-3']);
    expect(refs(await A.c.get(`/api/records/transport?f=${f({ 'Date de départ': { from: '2026-10-10', to: '2026-10-31' } })}`))).toEqual(['T-2']);
    expect((await A.c.get(`/api/records/transport?f=${f({ inconnu: 'x' })}`)).status).toBe(400);
    expect((await A.c.get(`/api/records/clients?f=${f({ 'N° contribuable': 'x' })}`)).status).toBe(400);
    expect((await A.c.get(`/api/records/transport?sort=${encodeURIComponent("x'); DROP TABLE records; --")}`)).status).toBe(400);
    expect((await A.c.get('/api/records/transport?f=pasdujson')).status).toBe(400);
  });

  it('une date mal saisie (données importées) ne fait pas échouer le tri', async () => {
    const A = await adminOf();
    await A.c.post('/api/admin/import-legacy', { data: { fleet: [{ Immatriculation: 'X-1', 'Marque / modèle': 'A', 'Assurance valide jusqu’au': '31/12/2026', Statut: 'Disponible' }] } });
    const r = await A.c.get(`/api/records/fleet?sort=${encodeURIComponent('Assurance valide jusqu’au')}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
  });
});

describe('Historique d’un enregistrement', () => {
  it('liste création, modifications (champ par champ) et annulation, sans exposer les champs sensibles', async () => {
    const A = await adminOf();
    const r = await A.c.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'SOTRAC', 'N° contribuable': 'NIF-1' } });
    await A.c.patch(`/api/records/clients/${r.body.id}`, { version: 1, data: { 'Téléphone': '+235 66', 'N° contribuable': 'NIF-2' } });
    await A.c.post(`/api/records/clients/${r.body.id}/cancel`, { reason: 'Doublon' });
    const h = await A.c.get(`/api/records/clients/${r.body.id}/history`);
    expect(h.body.map((x: { action: string }) => x.action)).toEqual(['record.cancel', 'record.update', 'record.create']);
    const upd = h.body[1];
    expect(upd.changes).toEqual(expect.arrayContaining([{ field: 'Téléphone', from: null, to: '+235 66' }, { field: 'N° contribuable', from: '••••', to: '••••' }]));
    expect(JSON.stringify(h.body)).not.toMatch(/NIF-|enc:/);
    expect(h.body[0].reason).toBe('Doublon');
    expect(h.body[0].user).toBe('Administrateur');
  });

  it('respecte les droits du module', async () => {
    const A = await adminOf();
    const inv = await A.c.post('/api/records/invoices', invoice('H-1'));
    const agent = new Client(env.app);
    await agent.login(await addUser(A.company.id, 'agent'));
    expect((await agent.get(`/api/records/invoices/${inv.body.id}/history`)).status).toBe(403);
  });
});

describe('Recherche globale', () => {
  it('regroupe par catégorie et sépare clients/fournisseurs, importations/exportations', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'Moundou Négoce' } });
    await A.c.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Fournisseur', 'Nom / raison sociale': 'Moundou Pièces' } });
    await A.c.post('/api/records/transport', mission('M-77'));
    await A.c.post('/api/records/importexport', { data: { 'Référence': 'IE-1', 'Type (Import/Export)': 'Export', 'Client / fournisseur': 'Moundou Coton', Statut: 'En cours' } });
    const r = await A.c.get('/api/search?q=moundou');
    const labels = r.body.groups.map((g: { label: string }) => g.label).sort();
    expect(labels).toEqual(['Clients', 'Exportations', 'Fournisseurs', 'Missions']);
    expect(r.body.groups.find((g: { label: string }) => g.label === 'Missions').items[0].title).toBe('M-77');
  });

  it('ne renvoie que les modules lisibles et jamais une autre société', async () => {
    const A = await adminOf();
    const B = await adminOf();
    await A.c.post('/api/records/invoices', invoice('SECRET-FAC'));
    await A.c.post('/api/records/transport', mission('SECRET-MIS'));
    const agent = new Client(env.app);
    await agent.login(await addUser(A.company.id, 'agent'));
    const ra = await agent.get('/api/search?q=secret');
    expect(ra.body.groups.map((g: { label: string }) => g.label)).toEqual(['Missions']);
    expect((await B.c.get('/api/search?q=secret')).body.groups).toEqual([]);
    expect((await agent.get('/api/search?q=a')).status).toBe(400);
  });
});

describe('Notifications et activité', () => {
  it('signale assurance expirée, facture échue, stock sous seuil ; filtre par droits', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/fleet', { data: { Immatriculation: 'TD-1', 'Marque / modèle': 'Renault', Statut: 'Disponible', 'Assurance valide jusqu’au': '2020-01-01' } });
    await A.c.post('/api/records/invoices', invoice('ECH-1', { 'Échéance': '2020-01-01' }));
    await A.c.post('/api/records/invoices', invoice('PAYEE-1', { 'Échéance': '2020-01-01', Statut: 'Payée' }));
    await A.c.post('/api/records/commerce', { data: { 'Code article': 'C-1', 'Désignation': 'Ciment', 'Quantité en stock': '3', 'Stock minimum': '10' } });
    const n = await A.c.get('/api/notifications');
    expect(n.body.counts).toEqual({ fleet: 1, invoices: 1, commerce: 1 });
    expect(n.body.items.find((x: { module: string }) => x.module === 'fleet').level).toBe('danger');
    const agent = new Client(env.app);
    await agent.login(await addUser(A.company.id, 'agent'));
    expect((await agent.get('/api/notifications')).body.items).toEqual([]);
  });

  it('activité récente : seulement les opérations de l’utilisateur', async () => {
    const A = await adminOf();
    const agent = new Client(env.app);
    await agent.login(await addUser(A.company.id, 'agent'));
    await A.c.post('/api/records/transport', mission('ADM-1'));
    await agent.post('/api/records/transport', mission('AG-1'));
    const act = await agent.get('/api/activity');
    expect(act.body.map((x: { reference: string }) => x.reference)).toEqual(['AG-1']);
    void owner;
  });
});

describe('Compteurs par statut et mentions légales', () => {
  it('compte par statut, en respectant les filtres de la vue', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/transport', mission('S-1', { Statut: 'En cours' }));
    await A.c.post('/api/records/transport', mission('S-2', { Statut: 'En cours' }));
    await A.c.post('/api/records/transport', mission('S-3', { Statut: 'En attente', Client: 'Autre' }));
    expect((await A.c.get('/api/records/transport/stats')).body).toEqual({ total: 3, byStatus: { 'En cours': 2, 'En attente': 1 } });
    expect((await A.c.get(`/api/records/transport/stats?f=${f({ Client: 'autre' })}`)).body.total).toBe(1);
  });
  it('facture multi-lignes de bout en bout ; RCCM et contribuable enregistrés', async () => {
    const A = await adminOf();
    const r = await A.c.post('/api/records/invoices', { data: { 'Numéro de facture': 'ML-1', Client: 'C', Date: '2026-10-31', Statut: 'Brouillon', Chauffeur: 'Ali', 'N° de camion': 'LT 123', 'Avance (FCFA)': '100000',
      Lignes: [{ 'Désignation': 'Transport', 'Quantité': '1', 'Prix unitaire (FCFA)': '400000' }, { 'Désignation': 'Déchargement', 'Quantité': '2', 'Prix unitaire (FCFA)': '25000' }] } });
    expect(r.status).toBe(201);
    expect(r.body.computed).toMatchObject({ totalTTC: 450000, reste: 350000, totalEnLettres: 'quatre cent cinquante mille francs CFA' });
    const s = await A.c.put('/api/admin/settings', { name: 'RAHA TRANSPORT', rccm: 'CM-DLA-02-2024-B12-00521', taxId: 'M062417047737R' });
    expect(s.status).toBe(200);
    expect((await A.c.get('/api/admin/settings')).body.rccm).toBe('CM-DLA-02-2024-B12-00521');
    expect((await A.c.get('/api/auth/me')).body.instance).toBe('RAHA_TEST');
  });
});
