import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { addUser, APP_DB, Client, mission, newCompany, startApp } from './helpers.js';

let env: Awaited<ReturnType<typeof startApp>>;
const appDb = new PrismaClient({ datasources: { db: { url: APP_DB } } });
beforeAll(async () => { env = await startApp(); await env.ctx.redis.flushdb(); });
afterAll(async () => { await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect(); await appDb.$disconnect(); });

const T0 = Math.floor(Date.UTC(2026, 10, 12, 7, 0, 0) / 1000);
const route = (n = 200) => Array.from({ length: n }, (_, i) => [T0 + i * 10, 4.05 + i * 0.0012, 9.7 + i * 0.0003]);
const vehicle = (imm: string) => ({ data: { Immatriculation: imm, 'Marque / modèle': 'Mercedes Actros', Kilométrage: '120000', Statut: 'Disponible' } });

async function setup() {
  const co = await newCompany();
  const c = new Client(env.app);
  await c.login(co.email);
  const v = await c.post('/api/records/fleet', vehicle(`LT-${Math.random().toString(36).slice(2, 7)}`));
  const m = await c.post('/api/records/transport', mission(`M-${Math.random().toString(36).slice(2, 7)}`));
  return { ...co, c, vehicleId: v.body.id as string, missionId: m.body.id as string };
}

describe('Trajets GPS du parc automobile', () => {
  it('importe une trace, calcule la distance côté serveur et l’affiche avec le véhicule', async () => {
    const A = await setup();
    const r = await A.c.post('/api/gps/tracks', { vehicleId: A.vehicleId, missionId: A.missionId, driver: 'Moussa', source: 'gpx', fileName: 'trajet.gpx', points: route() });
    expect(r.status).toBe(201);
    expect(r.body.distanceM).toBeGreaterThan(25_000);
    const list = await A.c.get(`/api/gps/tracks?vehicle=${A.vehicleId}`);
    expect(list.body.total).toBe(1);
    expect(list.body.rows[0].vehicle).toMatch(/^LT-/);
    expect(list.body.rows[0].mission).toMatch(/^M-/);
    expect(list.body.rows[0].points).toBeUndefined();
    expect(list.body.totals.distanceM).toBe(r.body.distanceM);
    const one = await A.c.get(`/api/gps/tracks/${r.body.id}`);
    expect(one.body.points).toHaveLength(200);
    expect(one.body.points[0][0]).toBe(0);
    const gpx = await A.c.get(`/api/gps/tracks/${r.body.id}/gpx`);
    expect(gpx.headers['content-type']).toMatch(/gpx/);
    expect(gpx.raw).toContain('<trkpt');
    // Filtre par date (journée du Cameroun)
    expect((await A.c.get(`/api/gps/tracks?vehicle=${A.vehicleId}&from=2026-11-12&to=2026-11-12`)).body.total).toBe(1);
    expect((await A.c.get(`/api/gps/tracks?vehicle=${A.vehicleId}&from=2026-11-13`)).body.total).toBe(0);
  });

  it('refuse les traces invalides et les véhicules d’une autre société', async () => {
    const A = await setup();
    const B = await setup();
    expect((await A.c.post('/api/gps/tracks', { vehicleId: A.vehicleId, source: 'gpx', points: [[T0, 95, 9]] })).status).toBe(400);
    expect((await A.c.post('/api/gps/tracks', { vehicleId: A.vehicleId, source: 'gpx', points: [[T0, 4, 9], [T0 + 9e9, 4, 9]] })).status).toBe(400);
    expect((await A.c.post('/api/gps/tracks', { vehicleId: A.vehicleId, source: 'gpx', points: route(), distanceM: 1 })).status).toBe(400); // champ imposé : rejet
    expect((await A.c.post('/api/gps/tracks', { vehicleId: A.missionId, source: 'gpx', points: route() })).status).toBe(400); // pas un véhicule
    expect((await A.c.post('/api/gps/tracks', { vehicleId: B.vehicleId, source: 'gpx', points: route() })).status).toBe(400); // véhicule d'une autre société
    const r = await B.c.post('/api/gps/tracks', { vehicleId: B.vehicleId, source: 'csv', points: route() });
    expect((await A.c.get(`/api/gps/tracks/${r.body.id}`)).status).toBe(404);
    expect((await A.c.get('/api/gps/tracks')).body.total).toBe(0);
  });

  it('droits : l’agent ne voit pas le parc, le responsable transport importe sans pouvoir annuler', async () => {
    const A = await setup();
    const agent = new Client(env.app); await agent.login(await addUser(A.company.id, 'agent'));
    expect((await agent.get('/api/gps/tracks')).status).toBe(403);
    const tr = new Client(env.app); await tr.login(await addUser(A.company.id, 'transport'));
    const r = await tr.post('/api/gps/tracks', { vehicleId: A.vehicleId, source: 'telephone', points: route(50) });
    expect(r.status).toBe(201);
    expect((await tr.patch(`/api/gps/tracks/${r.body.id}`, { label: 'Douala – Edéa', driver: 'Ali' })).status).toBe(200);
    expect((await tr.post(`/api/gps/tracks/${r.body.id}/cancel`, { reason: 'erreur' })).status).toBe(403);
    expect((await A.c.post(`/api/gps/tracks/${r.body.id}/cancel`, { reason: 'mauvais véhicule' })).status).toBe(200);
    expect((await A.c.get(`/api/gps/tracks/${r.body.id}`)).status).toBe(404);
  });

  it('la base interdit la suppression et la modification de la trace', async () => {
    const A = await setup();
    const r = await A.c.post('/api/gps/tracks', { vehicleId: A.vehicleId, source: 'gpx', points: route(20) });
    const asA = (sql: string) => appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.company_id', '${A.company.id}', true)`);
      return tx.$executeRawUnsafe(sql);
    });
    await expect(asA(`DELETE FROM gps_tracks WHERE id = '${r.body.id}'`)).rejects.toThrow(/permission denied|interdite/);
    await expect(asA(`UPDATE gps_tracks SET distance_m = 1 WHERE id = '${r.body.id}'`)).rejects.toThrow(/immuable/);
    expect(await asA(`UPDATE gps_tracks SET label = 'ok' WHERE id = '${r.body.id}'`)).toBe(1);
    const audit = await A.c.get('/api/admin/audit?limit=20');
    if (audit.status === 200) expect(JSON.stringify(audit.body)).toContain('gps.import');
  });
});
