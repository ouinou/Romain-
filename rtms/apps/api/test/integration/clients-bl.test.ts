import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addUser, Client, invoice, mission, newCompany, owner, startApp } from './helpers.js';
import { categoryOf, trendOf } from '../../src/modules/clientRanking.js';

let env: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { env = await startApp(); await env.ctx.redis.flushdb(); });
afterAll(async () => { await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect(); });

async function adminOf() {
  const co = await newCompany();
  const c = new Client(env.app);
  await c.login(co.email);
  return { ...co, c };
}
const clientsNamed = async (c: Client, name: string) => (await c.get(`/api/records/clients?q=${encodeURIComponent(name)}`)).body.items.filter((x: any) => x.data['Nom / raison sociale'].toLowerCase() === name.toLowerCase());

describe('Enregistrement automatique des clients', () => {
  it('une facture crée la fiche client avec le téléphone, sans doublon', async () => {
    const A = await adminOf();
    expect((await A.c.post('/api/records/invoices', invoice('', { Client: 'Brasseries du Nord', Contacts: '+237 699 11 22 33' }))).status).toBe(201);
    let list = await clientsNamed(A.c, 'Brasseries du Nord');
    expect(list).toHaveLength(1);
    expect(list[0].data['Téléphone']).toBe('+237 699 11 22 33');
    expect(list[0].data['Type (Client/Fournisseur)']).toBe('Client');
    expect(list[0].data['Origine de la fiche']).toMatch(/Créée automatiquement \(facture F-/);
    // Même client, casse et espaces différents : pas de nouvelle fiche
    await A.c.post('/api/records/invoices', invoice('', { Client: '  brasseries   du NORD ' }));
    await A.c.post('/api/records/transport', mission('M-AUTO-1', { Client: 'Brasseries du Nord' }));
    list = await clientsNamed(A.c, 'Brasseries du Nord');
    expect(list).toHaveLength(1);
  });

  it('complète le téléphone d’une fiche existante qui n’en a pas, sans toucher au reste', async () => {
    const A = await adminOf();
    await A.c.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'SOCAVER', Adresse: 'Bonabéri' } });
    await A.c.post('/api/records/invoices', invoice('', { Client: 'Socaver', Contacts: '677000000' }));
    const [c] = await clientsNamed(A.c, 'SOCAVER');
    expect(c.data['Téléphone']).toBe('677000000');
    expect(c.data.Adresse).toBe('Bonabéri');
  });

  it('le commercial (sans droit de création de clients) enregistre quand même le client par la facture', async () => {
    const A = await adminOf();
    const com = new Client(env.app); await com.login(await addUser(A.company.id, 'commercial'));
    expect((await com.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'X' } })).status).toBe(201); // EDIT sur clients
    const fin = new Client(env.app); await fin.login(await addUser(A.company.id, 'finance'));
    expect((await fin.post('/api/records/clients', { data: { 'Type (Client/Fournisseur)': 'Client', 'Nom / raison sociale': 'Y' } })).status).toBe(403);
    expect((await fin.post('/api/records/invoices', invoice('', { Client: 'Client Comptable SA' }))).status).toBe(201);
    expect(await clientsNamed(A.c, 'Client Comptable SA')).toHaveLength(1);
  });

  it('une facture refusée ne crée aucune fiche', async () => {
    const A = await adminOf();
    expect((await A.c.post('/api/records/invoices', invoice('', { Client: 'Fantôme SARL', 'Avance (FCFA)': '99999999' }))).status).toBe(400);
    expect(await clientsNamed(A.c, 'Fantôme SARL')).toHaveLength(0);
  });
});

describe('Classement des clients', () => {
  it('classe par nombre de commandes et donne les montants aux seuls profils autorisés', async () => {
    const A = await adminOf();
    for (const d of ['2026-01-10', '2026-03-05', '2026-05-12', '2026-06-20', '2026-08-02', '2026-09-15', '2026-10-30']) await A.c.post('/api/records/invoices', invoice('', { Client: 'Fidèle SA', Date: d }));
    await A.c.post('/api/records/invoices', invoice('', { Client: 'Rare SARL', Date: '2025-12-01' }));
    const r = await A.c.get('/api/reports/clients');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.clients[0].name).toBe('Fidèle SA');
    expect(r.body.clients[0].orders).toBe(7);
    expect(r.body.clients[0].revenue).toBeGreaterThan(0);
    expect(r.body.clients[0].clientId).toBeTruthy();
    const tr = new Client(env.app); await tr.login(await addUser(A.company.id, 'transport'));
    const t = await tr.get('/api/reports/clients');
    expect(t.status).toBe(200);
    expect(t.body.clients[0].revenue).toBeUndefined();
    const ag = new Client(env.app); await ag.login(await addUser(A.company.id, 'agent'));
    expect((await ag.get('/api/reports/clients')).status).toBe(403);
  });
  it('catégories et tendance', () => {
    const now = new Date('2026-11-15');
    expect(categoryOf({ first: new Date('2025-01-01'), last: new Date('2026-11-01'), months12: 8 }, now)).toBe('Régulier');
    expect(categoryOf({ first: new Date('2025-01-01'), last: new Date('2026-05-01'), months12: 8 }, now)).toBe('Inactif');
    expect(categoryOf({ first: new Date('2026-10-01'), last: new Date('2026-11-01'), months12: 2 }, now)).toBe('Nouveau');
    expect(categoryOf({ first: new Date('2025-06-01'), last: new Date('2026-10-01'), months12: 3 }, now)).toBe('Occasionnel');
    expect(categoryOf({ first: new Date('2026-07-01'), last: new Date('2026-09-01'), months12: 1 }, now)).toBe('Ponctuel');
    expect(trendOf(10, 4)).toBe('hausse'); expect(trendOf(2, 8)).toBe('baisse'); expect(trendOf(5, 5)).toBe('stable');
  });
});

describe('BL et douane, caisse, réglages', () => {
  it('module BL : droits par défaut, alerte de fin de franchise, client créé', async () => {
    const A = await adminOf();
    const soon = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const r = await A.c.post('/api/records/bl', { data: { 'N° BL': 'MEDU1234567', 'Type de titre': 'Connaissement maritime (B/L)', Client: 'Importateur BL SA', 'N° conteneur(s)': 'MSCU1234565', 'Fin de franchise': soon, Statut: 'Arrivé' } });
    expect(r.status).toBe(201);
    expect(await clientsNamed(A.c, 'Importateur BL SA')).toHaveLength(1);
    const n = await A.c.get('/api/notifications');
    expect(n.body.items.some((x: any) => x.module === 'bl' && /franchise/i.test(x.message))).toBe(true);
    const transit = new Client(env.app); await transit.login(await addUser(A.company.id, 'transit'));
    expect((await transit.post('/api/records/bl', { data: { 'N° BL': 'BL-2', 'Type de titre': 'Bon de livraison', Client: 'Z', Statut: 'Attendu' } })).status).toBe(201);
    const fin = new Client(env.app); await fin.login(await addUser(A.company.id, 'finance'));
    expect((await fin.get('/api/records/bl')).status).toBe(200);
    expect((await fin.post('/api/records/bl', { data: { 'N° BL': 'BL-3', 'Type de titre': 'Bon de livraison', Client: 'Z', Statut: 'Attendu' } })).status).toBe(403);
    const com = new Client(env.app); await com.login(await addUser(A.company.id, 'commercial'));
    expect((await com.get('/api/records/bl')).status).toBe(403);
  });

  it('migration 0008 : les sociétés existantes ont les droits du module BL', async () => {
    const rows = await owner.rolePermission.findMany({ where: { module: 'bl', roleKey: 'transit' } });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('caisse : solde des mouvements en espèces, visible du comptable uniquement', async () => {
    const A = await adminOf();
    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const mv = (type: string, m: number, mode: string) => A.c.post('/api/records/finance', { data: { 'Type (Recette/Dépense)': type, 'Libellé': 'test', 'Montant (FCFA)': m, 'Mode de paiement': mode, Date: today } });
    await mv('Recette', 150000, 'Espèces'); await mv('Dépense', 40000, 'Espèces'); await mv('Recette', 900000, 'Virement');
    const d = await A.c.get('/api/dashboard');
    expect(d.body.cash).toEqual({ solde: 110000, entreesJour: 150000, sortiesJour: 40000, mouvementsJour: 2 });
    const tr = new Client(env.app); await tr.login(await addUser(A.company.id, 'transport'));
    expect((await tr.get('/api/dashboard')).body.cash).toBeNull();
  });

  it('réglages : commerce masqué par défaut, plateforme GPS en https uniquement', async () => {
    const A = await adminOf();
    expect((await A.c.get('/api/auth/me')).body.company).toEqual({ commerceEnabled: false, trackerName: '', trackerUrl: '' });
    expect((await A.c.put('/api/admin/settings', { name: 'RAHA', trackerUrl: 'http://exemple.com' })).status).toBe(400);
    expect((await A.c.put('/api/admin/settings', { name: 'RAHA', commerceEnabled: true, trackerName: 'SinoTrack', trackerUrl: 'https://exemple-traceur.com' })).status).toBe(200);
    expect((await A.c.get('/api/auth/me')).body.company).toEqual({ commerceEnabled: true, trackerName: 'SinoTrack', trackerUrl: 'https://exemple-traceur.com' });
  });
});
