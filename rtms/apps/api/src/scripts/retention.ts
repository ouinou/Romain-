/**
 * Politique de conservation (à valider avec RAHA TRANSPORT et un conseil juridique).
 * - Données comptables et factures : JAMAIS purgées par ce script (OHADA : 10 ans à vérifier).
 * - Journal d'audit : immuable, non purgé (archivage à froid via sauvegardes).
 * - Événements de licence : purge au-delà de LICENSE_EVENTS_RETENTION_DAYS (défaut 730).
 * - Sessions : expiration automatique dans Redis (TTL).
 */
import { PrismaClient } from '@prisma/client';

export async function applyRetention(prisma: PrismaClient, days = Number(process.env.LICENSE_EVENTS_RETENTION_DAYS ?? 730)) {
  const before = new Date(Date.now() - days * 86400_000);
  // license_events n'a pas de trigger d'immuabilité : purge par le rôle propriétaire uniquement
  const r = await prisma.licenseEvent.deleteMany({ where: { at: { lt: before }, type: { notIn: ['revoked', 'anomaly_suspended', 'created'] } } });
  return { licenseEventsDeleted: r.count };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL } } });
  applyRetention(prisma).then((r) => console.log(JSON.stringify(r))).finally(() => prisma.$disconnect());
}
