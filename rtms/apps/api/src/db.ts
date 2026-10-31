import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;
export interface TenantCtx { companyId: string; userId?: string }

export function createPrisma(url: string) {
  return new PrismaClient({ datasources: { db: { url } }, log: ['warn', 'error'] });
}

/**
 * Toute requête métier passe par ici : la société courante est posée dans la
 * transaction (SET LOCAL) et la RLS PostgreSQL filtre le reste. Un oubli de
 * filtre côté code ne peut donc pas exposer les données d'une autre société.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantCtx,
  fn: (tx: Tx) => Promise<T>,
  opts: { isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.company_id', ${ctx.companyId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
    return fn(tx);
  }, { maxWait: 5000, timeout: 15000, ...opts });
}
