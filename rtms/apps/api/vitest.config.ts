import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    // Les tests d'intégration partagent une base : exécution séquentielle
    fileParallelism: false,
    coverage: { provider: 'v8', include: ['src/**'] },
  },
});
