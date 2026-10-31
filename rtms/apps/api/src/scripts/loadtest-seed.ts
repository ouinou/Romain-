/**
 * Prépare un environnement de TEST de charge : une société + N agents (sans MFA).
 * Refuse de s'exécuter si NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { seedCompany } from './seed.js';
import { hashPassword } from '../security/password.js';

if (process.env.NODE_ENV === 'production') { console.error('Interdit en production'); process.exit(1); }
const n = Number(process.argv[2] ?? 50);
const out = process.argv[3] ?? 'users.json';
const password = `Charge ${randomUUID()} test`;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.MIGRATION_DATABASE_URL } } });
const { company } = await seedCompany(prisma, { companyName: 'Test de charge', email: `load-admin-${randomUUID().slice(0, 6)}@load.test`, password });
const hash = await hashPassword(password);
const users = Array.from({ length: n }, (_, i) => ({ companyId: company.id, email: `load-${i}-${randomUUID().slice(0, 6)}@load.test`, fullName: `Agent ${i}`, roleKey: 'transport', passwordHash: hash }));
await prisma.user.createMany({ data: users });
writeFileSync(out, JSON.stringify({ password, emails: users.map((u) => u.email) }));
console.log(`${n} utilisateurs créés → ${out}`);
await prisma.$disconnect();
