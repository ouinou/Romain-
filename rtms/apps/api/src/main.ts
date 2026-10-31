import { initTelemetry, shutdownTelemetry } from './observability/telemetry.js';
initTelemetry();

import { buildApp } from './app.js';
import { closeContext, createContext } from './bootstrap.js';
import { loadConfig } from './config.js';

async function main() {
  const config = await loadConfig();
  const ctx = await createContext(config);
  ctx.license.startAutoRefresh();
  void ctx.license.refresh();
  const app = await buildApp(ctx);
  const stop = async (sig: string) => {
    app.log.info({ sig }, 'arrêt en cours');
    await app.close();
    await closeContext(ctx);
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((e) => {
  console.error('Démarrage impossible :', e instanceof Error ? e.message : e);
  process.exit(1);
});
