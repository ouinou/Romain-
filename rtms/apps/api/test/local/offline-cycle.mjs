// Test du poste principal hors ligne : sauvegarde, modification, restauration, contrôle d'audit.
// Usage : node test/local/offline-cycle.mjs https://127.0.0.1:8443 <email> <mot de passe>
// (certificat auto-signé : NODE_TLS_REJECT_UNAUTHORIZED=0 pour ce test uniquement)
import { authenticator } from 'otplib';
import fs from 'node:fs';
const [base, email, password, step, secretFile] = process.argv.slice(2);
let cookie = '', csrf = '';
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const j = await r.json().catch(() => ({}));
  if (j.csrfToken) csrf = j.csrfToken;
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const login = async () => {
  const me = await call('POST', '/api/auth/login', { email, password });
  if (me.state === 'mfa_enroll') {
    const s = await call('POST', '/api/auth/mfa/setup');
    fs.writeFileSync(secretFile, s.secret);
    await call('POST', '/api/auth/mfa/enable', { code: authenticator.generate(s.secret) });
  } else if (me.state === 'mfa_pending') {
    await new Promise((r) => setTimeout(r, 31_000)); // nouveau code TOTP (anti-rejeu)
    await call('POST', '/api/auth/mfa/verify', { code: authenticator.generate(fs.readFileSync(secretFile, 'utf8')) });
  }
};
const mission = (ref) => ({ data: { 'Référence mission': ref, Client: 'SOCAVER', 'Départ': 'Douala', Destination: 'Yaoundé', Statut: 'En cours' } });
await login();
if (step === 'avant') {
  for (const ref of ['L-1', 'L-2', 'L-3']) await call('POST', '/api/records/transport', mission(ref));
  const b = await call('POST', '/api/admin/backups');
  console.log('SAUVEGARDE', JSON.stringify({ file: b.file, rows: b.rows, size: b.size }));
  await call('POST', '/api/records/transport', mission('L-4-APRES-SAUVEGARDE'));
  console.log('missions avant restauration :', (await call('GET', '/api/records/transport')).total);
} else {
  const list = await call('GET', '/api/records/transport');
  console.log('missions après restauration :', list.total, list.items.map((i) => i.reference).sort().join(','));
  console.log('journal d’audit :', JSON.stringify(await call('GET', '/api/admin/audit/verify')));
  console.log('sauvegardes listées :', (await call('GET', '/api/admin/backups')).items.length);
}
