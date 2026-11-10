import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { safeEqual } from './crypto.js';
import { SESSION_COOKIE } from './security/guard.js';
import { authRoutes } from './auth/routes.js';
import { recordRoutes } from './modules/routes.js';
import { dashboardRoutes } from './modules/dashboard.js';
import { adminRoutes } from './admin/routes.js';
import { workspaceRoutes } from './modules/workspace.js';
import { presenceRoutes, touchPresence } from './security/presence.js';
import { registerMetrics, licenseState } from './observability/metrics.js';
import { captureError } from './observability/telemetry.js';

import { APP_VERSION } from './version.js';
export { APP_VERSION };
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT = new Set(['/api/auth/login']);

export interface BuildOptions {
  logger?: boolean;
  /** Certificat TLS du serveur local (poste principal). */
  https?: { key: string; cert: string };
  /** Routes supplémentaires (mode local : installation initiale, sauvegardes). */
  extraRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

export async function buildApp(ctx: AppContext, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    ...(opts.https ? { https: { key: opts.https.key, cert: opts.https.cert, minVersion: 'TLSv1.2' as const } } : {}),
    logger: opts.logger === false ? false : {
      level: config.LOG_LEVEL,
      // Jamais de secrets dans les journaux (centralisés dans Loki)
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], censor: '[masqué]' },
    },
    trustProxy: config.TRUST_PROXY === 'true' ? true : config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // attributs style= hérités du prototype ; aucun script inline
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
      },
    },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  const cookieName = SESSION_COOKIE(config.COOKIE_SECURE);
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    ...(config.REDIS_URL === 'memory' ? {} : { redis: ctx.redis }),
    nameSpace: 'rl:',
    // Utilisateur authentifié → compteur par utilisateur (un bureau derrière une seule IP
    // publique n'est pas bridé en bloc) ; sinon compteur par IP. Les plafonds par IP
    // « bruts » sont appliqués en amont par Cloudflare (infra/cloudflare).
    keyGenerator: async (req) => {
      const token = req.cookies[cookieName];
      if (token) {
        const s = await ctx.sessions.get(token);
        if (s) { req.session = s; req.sessionToken = token; return `u:${s.userId}`; }
      }
      return `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, c) => ({ statusCode: 429, code: 'trop_de_requetes', message: `Trop de requêtes. Réessayez dans ${Math.ceil(c.ttl / 1000)} s.` }),
  });

  // ---------- Session, origine et CSRF ----------
  const allowedOrigin = new URL(config.PUBLIC_ORIGIN).origin;
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!req.session) {
      const token = req.cookies[cookieName];
      const s = await ctx.sessions.get(token);
      if (s) { req.session = s; req.sessionToken = token; }
    }
    const s = req.session;
    if (s && req.sessionToken) await touchPresence(ctx.redis, s, req.sessionToken, req);

    if (MUTATING.has(req.method)) {
      const origin = req.headers.origin;
      const sameHost = config.ORIGIN_MATCH_HOST && origin === `${req.protocol}://${req.headers.host}`;
      if (origin && origin !== allowedOrigin && !sameHost) throw new HttpError(403, 'origine_refusee', 'Origine non autorisée');
      if (!origin && req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'origine_refusee', 'Origine non autorisée');
      const path = req.url.split('?')[0]!;
      if (!CSRF_EXEMPT.has(path) && s) {
        const h = req.headers['x-csrf-token'];
        if (typeof h !== 'string' || !safeEqual(h, s.csrf)) throw new HttpError(403, 'csrf', 'Jeton CSRF manquant ou invalide');
      }
    }
  });

  // ---------- Licence : installation locale bloquée à la fin de l'essai, sans licence ----------
  // Restent ouverts : connexion, état et activation de la licence, installation, sauvegardes.
  const LICENSE_OPEN = [/^\/api\/auth\//, /^\/api\/local\/shutdown$/, /^\/api\/admin\/license(\/activate)?$/, /^\/api\/setup/, /^\/api\/admin\/backups/];
  app.addHook('preHandler', async (req) => {
    if (ctx.license.usable() || !req.url.startsWith('/api/')) return;
    const path = req.url.split('?')[0]!;
    if (LICENSE_OPEN.some((r) => r.test(path))) return;
    throw new HttpError(402, 'licence_requise', ctx.license.status().reason ?? 'Licence requise');
  });

  // ---------- Licence : écritures métier bloquées si invalide (mode enforce) ----------
  app.addHook('preHandler', async (req) => {
    if (!MUTATING.has(req.method)) return;
    const path = req.url.split('?')[0]!;
    if ((path.startsWith('/api/records/') || path === '/api/admin/import-legacy') && !ctx.license.writable()) {
      throw new HttpError(402, 'licence_invalide', `Licence ${ctx.license.status().state} : consultation seule. Contactez l’administrateur.`);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: 'requete_invalide', message: 'Requête invalide', details: err.issues.map((i) => i.message) });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ code: err.code ?? 'erreur', message: err.statusCode === 429 ? err.message : 'Requête refusée' });
    }
    req.log.error({ err }, 'erreur interne');
    captureError(err);
    // Aucun détail technique renvoyé au client
    return reply.status(500).send({ code: 'erreur_interne', message: 'Erreur interne. Référence : ' + req.id });
  });

  registerMetrics(app, config.METRICS_TOKEN);
  licenseState.set(ctx.license.writable() ? 1 : 0);

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
      await ctx.redis.ping();
      return { ok: true, version: APP_VERSION };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  authRoutes(app, ctx);
  recordRoutes(app, ctx);
  dashboardRoutes(app, ctx);
  adminRoutes(app, ctx, APP_VERSION);
  workspaceRoutes(app, ctx);
  presenceRoutes(app, ctx);
  if (opts.extraRoutes) await opts.extraRoutes(app);

  if (config.WEB_ROOT) {
    await app.register(fastifyStatic, { root: config.WEB_ROOT, index: ['index.html'], dotfiles: 'deny' });
  }
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ code: 'introuvable', message: `Route ${req.method} ${req.url.split('?')[0]} introuvable` }));
  return app;
}
