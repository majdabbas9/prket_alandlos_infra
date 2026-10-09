import { Container, getContainer } from '@cloudflare/containers';

export { ContainerProxy } from '@cloudflare/containers';

interface Env {
  BACKEND: DurableObjectNamespace<Backend>;
  ADMIN_BACKEND: DurableObjectNamespace<AdminBackend>;
  R2_BUCKET_NAME: string;
  ACCESS_KEY_ID: string;
  SECRET_ACCESS_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_DATABASE_ID: string;
  D1_API_TOKEN: string;
  JWT_SECRET: string;
  // "true" = APIs switched off (set by .github/workflows/power.yml)
  API_DISABLED?: string;
}

// The backend validates tokens by calling ADMIN_BACKEND_URL/auth/validate.
// Containers have no private network, so that call goes to this fake host and
// is intercepted below and handed straight to the AdminBackend container.
const AUTH_HOST = 'auth.internal';

export class Backend extends Container<Env> {
  defaultPort = 8080;
  // Stay warm for a while after the last request; cold start re-fills the cache from R2.
  sleepAfter = '15m';
  enableInternet = true; // R2

  static outboundByHost = {
    [AUTH_HOST]: (req: Request, env: Env) => getContainer(env.ADMIN_BACKEND).fetch(req),
  };

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      ACCESS_KEY_ID: env.ACCESS_KEY_ID,
      SECRET_ACCESS_KEY: env.SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: env.R2_BUCKET_NAME,
      R2_ENDPOINT: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      ADMIN_BACKEND_URL: `http://${AUTH_HOST}`,
    };
  }
}

export class AdminBackend extends Container<Env> {
  defaultPort = 5001;
  sleepAfter = '15m';
  enableInternet = true; // D1 REST API

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_DATABASE_ID: env.CLOUDFLARE_DATABASE_ID,
      CLOUDFLARE_API_TOKEN: env.D1_API_TOKEN,
      JWT_SECRET: env.JWT_SECRET,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Switched off: never wake a container. Running ones get no traffic and
    // shut down gracefully once sleepAfter elapses; nothing is deleted.
    if (env.API_DISABLED === 'true') {
      return Response.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '3600' } });
    }
    const { pathname } = new URL(request.url);
    const binding = pathname === '/auth' || pathname.startsWith('/auth/') ? env.ADMIN_BACKEND : env.BACKEND;
    return getContainer(binding).fetch(request);
  },
} satisfies ExportedHandler<Env>;
