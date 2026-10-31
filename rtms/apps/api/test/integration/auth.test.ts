import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import { addUser, Client, newCompany, owner, PASSWORD, startApp } from './helpers.js';

let env: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => { env = await startApp(); await env.ctx.redis.flushdb(); });
afterAll(async () => { await env.app.close(); env.ctx.redis.disconnect(); await env.ctx.prisma.$disconnect(); });

describe('Authentification, MFA et sessions', () => {
  it('message identique pour compte inconnu et mauvais mot de passe', async () => {
    const { email } = await newCompany();
    const c = new Client(env.app);
    const a = await c.post('/api/auth/login', { email: 'inconnu@test.td', password: 'xxxxxxxxxxxx' });
    const b = await c.post('/api/auth/login', { email, password: 'mauvais-mot-de-passe' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('verrouille le compte après 5 échecs', async () => {
    const { email } = await newCompany();
    const c = new Client(env.app);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email, password: 'faux-mot-de-passe' });
    const r = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(r.status).toBe(423);
  });

  it('impose l’enrôlement MFA à l’administrateur avant tout accès', async () => {
    const { email } = await newCompany();
    const c = new Client(env.app);
    const r = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(r.body.state).toBe('mfa_enroll');
    expect((await c.get('/api/dashboard')).status).toBe(401);
    expect((await c.get('/api/records/invoices')).body.code).toBe('mfa_enrolement_requis');
  });

  it('parcours complet : enrôlement, reconnexion TOTP, anti-rejeu, code de secours', async () => {
    const { email } = await newCompany();
    const c = new Client(env.app);
    const { secret, recovery } = await c.login(email);
    expect(recovery).toHaveLength(10);
    expect((await c.get('/api/dashboard')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/dashboard')).status).toBe(401);

    const r = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(r.body.state).toBe('mfa_pending');
    const pendingCookie = c.cookie;
    const code = authenticator.generate(secret!);
    const ok = await c.post('/api/auth/mfa/verify', { code });
    expect(ok.status).toBe(200);
    expect(c.cookie).not.toBe(pendingCookie); // nouveau jeton après élévation

    // Même code rejoué sur une autre session : refusé
    const c2 = new Client(env.app);
    await c2.post('/api/auth/login', { email, password: PASSWORD });
    expect((await c2.post('/api/auth/mfa/verify', { code })).status).toBe(401);
    // Code de secours : utilisable une seule fois
    expect((await c2.post('/api/auth/mfa/verify', { code: recovery![0] })).status).toBe(200);
    const c3 = new Client(env.app);
    await c3.post('/api/auth/login', { email, password: PASSWORD });
    expect((await c3.post('/api/auth/mfa/verify', { code: recovery![0] })).status).toBe(401);
  });

  it('le secret MFA est chiffré en base', async () => {
    const { email, admin } = await newCompany();
    const c = new Client(env.app);
    const { secret } = await c.login(email);
    const u = await owner.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(u.mfaSecretEnc).toMatch(/^enc:v1:/);
    expect(u.mfaSecretEnc).not.toContain(secret!);
  });

  it('ferme la session après 5 codes MFA faux', async () => {
    const { email } = await newCompany();
    const c = new Client(env.app);
    await c.login(email);
    await c.post('/api/auth/logout');
    await c.post('/api/auth/login', { email, password: PASSWORD });
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await c.post('/api/auth/mfa/verify', { code: '000000' })).status;
    expect(last).toBe(401);
    expect((await c.post('/api/auth/mfa/verify', { code: '000000' })).body.code).toBe('non_authentifie');
  });

  it('CSRF : requête modifiante sans jeton ou depuis une autre origine refusée', async () => {
    const { company } = await newCompany();
    const email = await addUser(company.id, 'transport');
    const c = new Client(env.app);
    await c.login(email);
    const csrf = c.csrf;
    c.csrf = '';
    expect((await c.post('/api/records/transport', { data: {} })).body.code).toBe('csrf');
    c.csrf = csrf;
    const evil = await c.req('POST', '/api/records/transport', { data: {} }, { origin: 'https://attaquant.example' });
    expect(evil.body.code).toBe('origine_refusee');
  });

  it('cookie de session HttpOnly + SameSite=Strict', async () => {
    const { company } = await newCompany();
    const email = await addUser(company.id, 'agent');
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
  });

  it('changement de mot de passe : révoque les autres sessions', async () => {
    const { company } = await newCompany();
    const email = await addUser(company.id, 'agent');
    const a = new Client(env.app); const b = new Client(env.app);
    await a.login(email); await b.login(email);
    const next = 'Une autre phrase de passe solide 42';
    expect((await a.post('/api/auth/password', { current: PASSWORD, next })).status).toBe(200);
    expect((await a.get('/api/dashboard')).status).toBe(200);
    expect((await b.get('/api/dashboard')).status).toBe(401);
  });

  it('en-têtes de sécurité (CSP stricte pour les scripts)', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/healthz' });
    expect(String(r.headers['content-security-policy'])).toContain("script-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  });
});

describe('Limitation de débit', () => {
  it('bloque les tentatives de connexion en rafale (429)', async () => {
    const lim = await startApp({ LOGIN_RATE_LIMIT_PER_MINUTE: 3 });
    await lim.ctx.redis.flushdb();
    const c = new Client(lim.app);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post('/api/auth/login', { email: 'x@test.td', password: 'yyyyyyyyyyyy' })).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes[4]).toBe(429);
    await lim.app.close(); lim.ctx.redis.disconnect(); await lim.ctx.prisma.$disconnect();
  });
});
