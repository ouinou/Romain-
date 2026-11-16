import { describe, expect, it } from 'vitest';
import { webPathAllowed } from '../../src/app.js';

describe('Fichiers servis par le serveur (liste blanche)', () => {
  it('sert l’application et ses images, rien d’autre', () => {
    for (const p of ['/', '/index.html', '/app.css', '/src/main.js', '/src/views/TracksView.js', '/assets/logo-raha.png']) expect(webPathAllowed(p), p).toBe(true);
    for (const p of ['/package.json', '/e2e/.e2e-account.json', '/node_modules/x/index.js', '/demo.html', '/src/demo/mockApi.js', '/src/../package.json', '/src/%2e%2e/x.js', '/.env', '/src/.hidden.js', '/playwright-report/index.html', '/assets/x.html']) expect(webPathAllowed(p), p).toBe(false);
  });
});
