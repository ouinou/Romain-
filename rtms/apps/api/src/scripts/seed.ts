/**
 * Initialisation d'une société et de son premier administrateur.
 * Usage : RTMS_ADMIN_EMAIL=... RTMS_ADMIN_PASSWORD=... RTMS_COMPANY_NAME="RAHA TRANSPORT" npm run db:seed
 * Exécuté avec le rôle propriétaire (MIGRATION_DATABASE_URL). Aucun mot de passe par défaut.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordProblems } from '../security/password.js';
import { defaultPermissionRows } from '../security/permissions.js';

export async function seedCompany(prisma: PrismaClient, opts: { companyName: string; email: string; password: string; fullName?: string }) {
  const problems = passwordProblems(opts.password, opts.email);
  if (problems.length) throw new Error(`Mot de passe administrateur refusé : ${problems.join(', ')}`);
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { name: opts.companyName, settings: { currency: 'FCFA', language: 'Français' } } });
    await tx.rolePermission.createMany({ data: defaultPermissionRows(company.id) });
    const admin = await tx.user.create({
      data: { companyId: company.id, email: opts.email.toLowerCase(), fullName: opts.fullName ?? 'Administrateur', roleKey: 'admin', passwordHash: await hashPassword(opts.password) },
    });
    await tx.auditLog.create({ data: { companyId: company.id, userId: admin.id, action: 'company.created', entity: 'company', entityId: company.id } });
    return { company, admin };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const { RTMS_ADMIN_EMAIL: email, RTMS_ADMIN_PASSWORD: password, RTMS_COMPANY_NAME: name = 'RAHA TRANSPORT' } = process.env;
  if (!url || !email || !password) {
    console.error('MIGRATION_DATABASE_URL, RTMS_ADMIN_EMAIL et RTMS_ADMIN_PASSWORD sont requis');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  seedCompany(prisma, { companyName: name, email, password })
    .then(({ company }) => console.log(`Société créée : ${company.id}`))
    .catch((e) => { console.error(e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
