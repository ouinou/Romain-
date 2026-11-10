import { timingSafeEqual } from 'node:crypto';
/**
 * Routes propres au poste principal :
 * - installation initiale (création de la société et du premier administrateur),
 *   autorisée uniquement depuis le poste principal lui-même et seulement si la base est vide ;
 * - sauvegardes (liste, sauvegarde immédiate) pour l'administrateur.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { requirePermission } from '../security/guard.js';
import type { AppContext } from '../context.js';
import { seedCompany } from '../scripts/seed.js';
import { passwordProblems } from '../security/password.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function safeEqualStr(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function localRoutes(ctx: AppContext, owner: PrismaClient, backups: { list: () => unknown; now: () => Promise<unknown>; info: () => unknown }, shutdown?: { token: string; run: () => void }) {
  return (app: FastifyInstance) => {
    // Arrêt demandé par un nouveau démarrage de RTMS sur ce même poste (ancien serveur resté ouvert)
    if (shutdown) app.post('/api/local/shutdown', async (req, reply) => {
      const t = req.headers['x-rtms-shutdown'];
      if (!LOOPBACK.has(req.ip) || typeof t !== 'string' || !safeEqualStr(t, shutdown.token)) throw new HttpError(403, 'interdit', 'Refusé');
      setTimeout(shutdown.run, 50);
      return reply.send({ ok: true });
    });
    app.get('/api/setup/status', async (req) => ({ needsSetup: (await owner.company.count()) === 0, local: LOOPBACK.has(req.ip) }));

    app.post('/api/setup', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
      if (!LOOPBACK.has(req.ip)) throw new HttpError(403, 'interdit', 'L’installation se fait uniquement sur le poste principal.');
      if ((await owner.company.count()) > 0) throw new HttpError(409, 'conflit', 'Le logiciel est déjà installé.');
      const b = z.object({
        companyName: z.string().trim().min(2).max(200), fullName: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200),
      }).safeParse(req.body);
      if (!b.success) throw new HttpError(400, 'requete_invalide', 'Formulaire incomplet', b.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`));
      const problems = passwordProblems(b.data.password, b.data.email);
      if (problems.length) throw new HttpError(400, 'requete_invalide', `Mot de passe refusé : ${problems.join(', ')}`, problems);
      await seedCompany(owner, { companyName: b.data.companyName, email: b.data.email, password: b.data.password, fullName: b.data.fullName });
      return { ok: true };
    });

    app.get('/api/admin/backups', { preHandler: requirePermission(ctx, 'settings', 'admin') }, async () => ({ ...(backups.info() as object), items: backups.list() }));
    app.post('/api/admin/backups', { preHandler: requirePermission(ctx, 'settings', 'admin'), config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async () => backups.now());
  };
}
