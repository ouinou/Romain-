import type { FastifyInstance } from 'fastify';
import client from 'prom-client';
import { safeEqual } from '../crypto.js';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'rtms_' });

const httpDuration = new client.Histogram({
  name: 'rtms_http_request_duration_seconds', help: 'Durée des requêtes HTTP',
  labelNames: ['method', 'route', 'status'], buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [registry],
});
export const authEvents = new client.Counter({ name: 'rtms_auth_events_total', help: 'Événements d’authentification', labelNames: ['event'], registers: [registry] });
export const licenseState = new client.Gauge({ name: 'rtms_license_valid', help: '1 si la licence est valide ou en période de grâce', registers: [registry] });

export function registerMetrics(app: FastifyInstance, token?: string) {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    httpDuration.labels(req.method, route, String(reply.statusCode)).observe(reply.elapsedTime / 1000);
    if (route === '/api/auth/login') authEvents.labels(reply.statusCode === 200 ? 'login_ok' : `login_${reply.statusCode}`).inc();
  });
  // Exposé uniquement avec un jeton (Prometheus le fournit) ; à ne pas publier via Cloudflare
  app.get('/metrics', async (req, reply) => {
    const h = req.headers.authorization ?? '';
    if (!token || !safeEqual(h, `Bearer ${token}`)) return reply.status(404).send();
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
