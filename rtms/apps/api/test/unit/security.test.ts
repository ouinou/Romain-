import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_MATRIX } from '../../src/security/permissions.js';
import { passwordProblems } from '../../src/security/password.js';
import { loadVaultSecrets } from '../../src/vault.js';

describe('Matrice RBAC par défaut', () => {
  it('l’agent opérationnel ne peut ni annuler ni exporter, ni voir la facturation', () => {
    expect(DEFAULT_MATRIX.agent.transport).not.toContain('cancel');
    expect(DEFAULT_MATRIX.agent.transport).not.toContain('export');
    expect(DEFAULT_MATRIX.agent.invoices).toBeUndefined();
  });
  it('seul l’administrateur administre utilisateurs et paramètres', () => {
    for (const [role, m] of Object.entries(DEFAULT_MATRIX)) {
      if (role === 'admin') continue;
      expect(m.users ?? []).not.toContain('admin');
      expect(m.settings ?? []).not.toContain('admin');
    }
  });
  it('le commercial ne peut pas valider une facture', () => {
    expect(DEFAULT_MATRIX.commercial.invoices).not.toContain('validate');
  });
});

describe('Politique de mot de passe', () => {
  it('refuse les mots de passe faibles', () => {
    expect(passwordProblems('azerty123')).not.toEqual([]);
    expect(passwordProblems('RahaTransport1')).not.toEqual([]);
    expect(passwordProblems('jean.dupont-2026!', 'jean.dupont@raha.td')).not.toEqual([]);
  });
  it('accepte une phrase de passe robuste', () => {
    expect(passwordProblems('Camion vert sur la route de Moundou 7!')).toEqual([]);
  });
});

describe('Client Vault (AppRole + KV v2)', () => {
  it('se connecte, lit le secret et révoque son jeton', async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/auth/approle/login')) return new Response(JSON.stringify({ auth: { client_token: 'tok' } }));
      if (url.endsWith('/secret/data/rtms')) {
        expect((init?.headers as Record<string, string>)['x-vault-token']).toBe('tok');
        return new Response(JSON.stringify({ data: { data: { DATABASE_URL: 'postgres://x' } } }));
      }
      return new Response('{}');
    }) as typeof fetch;
    const s = await loadVaultSecrets({ addr: 'https://vault', roleId: 'r', secretId: 's', secretPath: 'secret/data/rtms', fetchImpl: fake });
    expect(s).toEqual({ DATABASE_URL: 'postgres://x' });
    expect(calls.at(-1)).toBe('POST https://vault/v1/auth/token/revoke-self');
  });
  it('échoue proprement si AppRole est refusé', async () => {
    const fake = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(loadVaultSecrets({ addr: 'https://v', roleId: 'r', secretId: 's', secretPath: 'p', fetchImpl: fake })).rejects.toThrow(/AppRole/);
  });
});

describe('Aucun secret dans le code client', () => {
  it('le frontend ne contient ni clé privée ni secret', () => {
    const webRoot = resolve(__dirname, '../../../web');
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'test-results' ? [] : walk(p)) : [p]; });
    const files = walk(webRoot).filter((f) => /\.(html|js|css|json)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/PRIVATE KEY|DATA_ENCRYPTION_KEYS|LICENSE_SIGNING|password\s*[:=]\s*['"][^'"]{4,}/i);
    }
  });
});
