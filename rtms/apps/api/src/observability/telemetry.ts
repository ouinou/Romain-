/**
 * Sentry (erreurs) et OpenTelemetry (traces) — activés seulement si configurés.
 * À importer en tout premier dans main.ts pour que l'instrumentation s'applique.
 */
import * as Sentry from '@sentry/node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

let sdk: NodeSDK | undefined;

export function initTelemetry(env = process.env) {
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    sdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME ?? 'rtms-api',
      traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
      instrumentations: [
        new HttpInstrumentation({ ignoreIncomingRequestHook: (r) => r.url === '/healthz' || r.url === '/metrics' }),
        new PgInstrumentation({ enhancedDatabaseReporting: false }), // jamais les paramètres SQL dans les traces
        new IORedisInstrumentation(),
      ],
    });
    sdk.start();
  }
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      release: env.RTMS_VERSION,
      tracesSampleRate: 0,
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.data;
          if (event.request.headers) {
            for (const h of ['cookie', 'authorization', 'x-csrf-token']) delete event.request.headers[h];
          }
        }
        return event;
      },
    });
  }
}

export const captureError = (e: unknown) => { if (process.env.SENTRY_DSN) Sentry.captureException(e); };
export async function shutdownTelemetry() { await sdk?.shutdown(); await Sentry.close(2000).catch(() => undefined); }
