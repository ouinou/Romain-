// Test de charge RTMS (k6). Usage :
//   k6 run -e BASE_URL=http://localhost:3000 -e USERS_FILE=users.json tests/load/rtms.k6.js
// Profil : montée à 50 utilisateurs simultanés, palier, puis pic à 100 (résistance).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const cfg = JSON.parse(open(__ENV.USERS_FILE || 'users.json'));
const emails = new SharedArray('emails', () => cfg.emails);

export const options = {
  noCookiesReset: true, // un utilisateur garde sa session d'une itération à l'autre
  scenarios: {
    charge: { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: '20s', target: 50 }, { duration: '60s', target: 50 },
      { duration: '20s', target: 100 }, { duration: '30s', target: 100 }, { duration: '10s', target: 0 },
    ] },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{type:read}': ['p(95)<300'],
    'http_req_duration{type:write}': ['p(95)<500'],
  },
};

const sessions = {};
function login() {
  const email = emails[(__VU - 1) % emails.length];
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: cfg.password }), { headers: { 'content-type': 'application/json', origin: BASE }, tags: { type: 'auth' } });
  check(r, { 'connexion 200': (x) => x.status === 200 });
  return r.json('csrfToken');
}

export default function () {
  if (!sessions[__VU]) sessions[__VU] = login();
  const csrf = sessions[__VU];
  const h = { headers: { 'content-type': 'application/json', origin: BASE, 'x-csrf-token': csrf } };

  check(http.get(`${BASE}/api/dashboard`, { tags: { type: 'read' } }), { 'dashboard 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/api/records/transport?limit=50`, { tags: { type: 'read' } }), { 'liste 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/api/records/transport?q=moundou&limit=50`, { tags: { type: 'read' } }), { 'recherche 200': (r) => r.status === 200 });
  if (Math.random() < 0.3) {
    const ref = `K6-${__VU}-${__ITER}-${Date.now()}`;
    const body = { data: { 'Référence mission': ref, Client: 'Client charge', 'Départ': "N'Djamena", Destination: 'Moundou', Marchandise: 'Ciment', Statut: 'En cours' } };
    check(http.post(`${BASE}/api/records/transport`, JSON.stringify(body), Object.assign({ tags: { type: 'write' } }, h)), { 'création 201': (r) => r.status === 201 });
  }
  if (__ENV.THINK !== "0") sleep(1 + Math.random() * 2); // temps de réflexion (THINK=0 : test de résistance)
}
