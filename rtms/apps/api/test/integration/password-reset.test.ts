import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addUser, Client, newCompany, owner, PASSWORD, startApp } from './helpers.js';
import { loadConfig } from '../../src/config.js';

let env: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { env = await startApp(); await env.ctx.redis.flushdb(); });
afterAll(async () => { await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect(); });

const NEW_PW = 'Nouveau mot de passe du camion 2026!';
async function adminOf() {
  const co = await newCompany();
  const c = new Client(env.app);
  await c.login(co.email);
  return { ...co, c };
}

describe('Mot de passe oublié : code à usage unique, qui expire', () => {
  it('le code remplace le mot de passe, ferme les sessions, ne sert qu’une fois', async () => {
    const A = await adminOf();
    const email = await addUser(A.company.id, 'transport');
    const u = await owner.user.findUniqueOrThrow({ where: { email } });
    const user = new Client(env.app); await user.login(email);
    const r = await A.c.post(`/api/admin/users/${u.id}/reset-code`);
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(r.body.minutes).toBe(30);
    // Le code n'est stocké qu'en empreinte, et n'apparaît pas dans l'audit
    const row = await owner.passwordReset.findFirstOrThrow({ where: { userId: u.id, usedAt: null } });
    expect(row.tokenHash).not.toContain(r.body.code.replace(/-/g, ''));
    const audit = await owner.auditLog.findFirstOrThrow({ where: { action: 'user.reset_code', entityId: u.id } });
    expect(JSON.stringify({ before: audit.before, after: audit.after })).not.toContain(r.body.code);

    const anon = new Client(env.app);
    // Mot de passe trop faible : refusé SANS consommer le code
    expect((await anon.post('/api/auth/password/reset', { email, code: r.body.code, next: 'court' })).status).toBe(400);
    // Bon e-mail obligatoire : le code d'un autre compte ne marche pas
    expect((await anon.post('/api/auth/password/reset', { email: A.email, code: r.body.code, next: NEW_PW })).status).toBe(400);
    // Saisie tolérante : minuscules, sans tirets
    expect((await anon.post('/api/auth/password/reset', { email, code: r.body.code.replace(/-/g, '').toLowerCase(), next: NEW_PW })).status).toBe(200);
    expect((await user.get('/api/dashboard')).status).toBe(401); // sessions fermées
    expect((await anon.post('/api/auth/password/reset', { email, code: r.body.code, next: `${NEW_PW}x` })).status).toBe(400); // déjà utilisé
    const again = new Client(env.app);
    await expect(again.login(email)).rejects.toThrow(/401/);
    await again.login(email, NEW_PW);
    expect((await again.get('/api/dashboard')).status).toBe(200);
  });

  it('un code expiré ou remplacé est refusé ; seul l’administrateur peut en créer', async () => {
    const A = await adminOf();
    const email = await addUser(A.company.id, 'agent');
    const u = await owner.user.findUniqueOrThrow({ where: { email } });
    const first = (await A.c.post(`/api/admin/users/${u.id}/reset-code`)).body.code;
    const second = (await A.c.post(`/api/admin/users/${u.id}/reset-code`)).body.code;
    const anon = new Client(env.app);
    expect((await anon.post('/api/auth/password/reset', { email, code: first, next: NEW_PW })).status).toBe(400);
    await owner.$executeRawUnsafe(`UPDATE password_resets SET created_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' WHERE user_id = '${u.id}' AND used_at IS NULL`);
    expect((await anon.post('/api/auth/password/reset', { email, code: second, next: NEW_PW })).status).toBe(400);
    expect(await owner.auditLog.count({ where: { action: 'auth.reset_failed' } })).toBeGreaterThan(0);
    const agent = new Client(env.app); await agent.login(email);
    expect((await agent.post(`/api/admin/users/${u.id}/reset-code`)).status).toBe(403);
    // Société B : ne peut pas créer de code pour un utilisateur de A
    const B = await adminOf();
    expect((await B.c.post(`/api/admin/users/${u.id}/reset-code`)).status).toBe(404);
  });

  it('essais répétés limités (anti force brute)', async () => {
    const anon = new Client(env.app);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await anon.post('/api/auth/password/reset', { email: 'cible@test.td', code: `AAAA-BBBB-CCCC-${1000 + i}`, next: NEW_PW })).status);
    expect(codes.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(codes.slice(5)).toContain(429);
  });
});

describe('Mot de passe provisoire : changement obligatoire à la première connexion', () => {
  it('un utilisateur créé par l’administrateur ne peut rien faire avant de changer son mot de passe', async () => {
    const A = await adminOf();
    const created = await A.c.post('/api/admin/users', { email: `nouveau-${Date.now()}@test.td`, fullName: 'Nouvel Agent', roleKey: 'agent' });
    expect(created.status).toBe(201);
    const u = new Client(env.app);
    const login = await u.post('/api/auth/login', { email: (await owner.user.findUniqueOrThrow({ where: { id: created.body.id } })).email, password: created.body.temporaryPassword });
    expect(login.body.state).toBe('password_change');
    const blocked = await u.get('/api/dashboard');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('changement_mot_de_passe_requis');
    const ch = await u.post('/api/auth/password', { current: created.body.temporaryPassword, next: NEW_PW });
    expect(ch.status).toBe(200);
    expect(ch.body.state).toBe('active');
    expect((await u.get('/api/dashboard')).status).toBe(200);
  });
  it('les comptes existants ne sont pas concernés', async () => {
    const A = await adminOf();
    const r = await new Client(env.app).post('/api/auth/login', { email: await addUser(A.company.id, 'transport'), password: PASSWORD });
    expect(r.body.state).toBe('active');
  });
});

describe('Activité suspecte, requêtes, configuration', () => {
  it('compte verrouillé et échecs répétés signalés aux profils qui lisent l’audit', async () => {
    const A = await adminOf();
    const email = await addUser(A.company.id, 'agent');
    const anon = new Client(env.app);
    for (let i = 0; i < 11; i++) await anon.post('/api/auth/login', { email, password: `mauvais ${i}` });
    const n = await A.c.get('/api/notifications');
    const sec = n.body.items.filter((x: any) => x.module === 'security');
    expect(sec.some((x: any) => /verrouillé/.test(x.message))).toBe(true);
    expect(sec.some((x: any) => /tentatives de connexion échouées/.test(x.message))).toBe(true);
    const tr = new Client(env.app); await tr.login(await addUser(A.company.id, 'transport'));
    expect((await tr.get('/api/notifications')).body.items.some((x: any) => x.module === 'security')).toBe(false);
  });

  it('corps de requête autre que JSON refusé ; pas d’autorisation CORS pour une autre origine', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'text/plain', origin: 'http://localhost:3000' }, payload: 'email=a' });
    expect(r.statusCode).toBe(415);
    const pre = await env.app.inject({ method: 'OPTIONS', url: '/api/records/transport', headers: { origin: 'https://pirate.example', 'access-control-request-method': 'POST' } });
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('configuration de production : refuse débogage et mots de passe d’exemple', async () => {
    const base = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://rtms.example', COOKIE_SECURE: 'true', LICENSE_ENFORCEMENT: 'enforce', DATA_ENCRYPTION_KEYS: 'v1:abc', DATABASE_URL: 'postgresql://rtms_app:Xk29!fz@db/rtms' };
    await expect(loadConfig({ ...base, LOG_LEVEL: 'debug' })).rejects.toThrow(/LOG_LEVEL/);
    await expect(loadConfig({ ...base, DATABASE_URL: 'postgresql://rtms_app:change-me@db/rtms' })).rejects.toThrow(/exemple/);
    await expect(loadConfig({ ...base, METRICS_TOKEN: 'court' })).rejects.toThrow(/METRICS_TOKEN/);
    await expect(loadConfig({ ...base, PUBLIC_ORIGIN: 'http://rtms.example' })).rejects.toThrow(/HTTPS/);
    await expect(loadConfig({ ...base, COOKIE_SECURE: 'false' })).rejects.toThrow(/COOKIE_SECURE/);
    await expect(loadConfig(base)).resolves.toBeTruthy();
  });
});
