/**
 * Sentry (erreurs) et OpenTelemetry (traces) — activés seulement si configurés.
 * Les bibliothèques sont chargées à la demande : le poste principal hors ligne (qui ne les
 * configure jamais) n'a pas besoin de les embarquer, ce qui allège l'installateur Windows.
 */
type SentryModule = typeof import('@sentry/node');
let sentry: SentryModule | undefined;
let sdk: { shutdown(): Promise<void> } | undefined;

export async function initTelemetry(env = process.env) {
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { PgInstrumentation }, { IORedisInstrumentation }] = await Promise.all([
      import('@opentelemetry/sdk-node'), import('@opentelemetry/exporter-trace-otlp-http'), import('@opentelemetry/instrumentation-http'),
      import('@opentelemetry/instrumentation-pg'), import('@opentelemetry/instrumentation-ioredis'),
    ]);
    const s = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME ?? 'rtms-api',
      traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
      instrumentations: [
        new HttpInstrumentation({ ignoreIncomingRequestHook: (r) => r.url === '/healthz' || r.url === '/metrics' }),
        new PgInstrumentation({ enhancedDatabaseReporting: false }), // jamais les paramètres SQL dans les traces
        new IORedisInstrumentation(),
      ],
    });
    s.start();
    sdk = s;
  }
  if (env.SENTRY_DSN) {
    sentry = await import('@sentry/node');
    sentry.init({
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

export const captureError = (e: unknown) => { sentry?.captureException(e); };
export async function shutdownTelemetry() { await sdk?.shutdown(); await sentry?.close(2000).catch(() => undefined); }
