import { Container, getContainer } from '@cloudflare/containers';

export { ContainerProxy } from '@cloudflare/containers';

interface Env {
  BACKEND: DurableObjectNamespace<Backend>;
  ADMIN_BACKEND: DurableObjectNamespace<AdminBackend>;
  // The same bucket the backend reads over the S3 API, bound directly for serving images
  BUCKET: R2Bucket;
  R2_BUCKET_NAME: string;
  // Public domain of the R2 bucket; when set, clients load product images from it directly
  R2_PUBLIC_URL?: string;
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
      NODE_ENV: 'production',
      PORT: String(this.defaultPort),
      REDIS_URL: 'redis://127.0.0.1:6379', // Redis runs inside this container
      REDIS_MAXMEMORY: '128mb',
      REDIS_MAXMEMORY_POLICY: 'allkeys-lru',
      ACCESS_KEY_ID: env.ACCESS_KEY_ID,
      SECRET_ACCESS_KEY: env.SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: env.R2_BUCKET_NAME,
      R2_ENDPOINT: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      ...(env.R2_PUBLIC_URL && { R2_PUBLIC_URL: env.R2_PUBLIC_URL }),
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
      NODE_ENV: 'production',
      PORT: String(this.defaultPort),
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_DATABASE_ID: env.CLOUDFLARE_DATABASE_ID,
      CLOUDFLARE_API_TOKEN: env.D1_API_TOKEN,
      JWT_SECRET: env.JWT_SECRET,
    };
  }
}

// Product image keys are unique per upload and never rewritten (see the backend's Product model)
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PHOTO_PATH = '/api/products/photo';

/**
 * Serves GET /api/products/photo?key=products/... straight from R2, so image requests never
 * wake the backend container or pass through Express. Returns null for keys it doesn't
 * handle, which then go to the container as before.
 */
async function servePhoto(request: Request, env: Env): Promise<Response | null> {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') ?? searchParams.get('url');
  if (!key || !key.startsWith('products/') || key.endsWith('.json')) return null;

  const object = await env.BUCKET.get(key, { onlyIf: request.headers });
  if (!object) {
    return Response.json(
      { success: false, error: 'Image not found in storage' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Cache-Control', IMMUTABLE_CACHE_CONTROL);
  headers.set('Access-Control-Allow-Origin', '*');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/jpeg');

  // No body means the If-None-Match / If-Modified-Since precondition matched
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Switched off: never wake a container. Running ones get no traffic and
    // shut down gracefully once sleepAfter elapses; nothing is deleted.
    if (env.API_DISABLED === 'true') {
      return Response.json({ error: 'Service temporarily unavailable' }, { status: 503, headers: { 'Retry-After': '3600' } });
    }
    const { pathname } = new URL(request.url);
    if (pathname === PHOTO_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      const photo = await servePhoto(request, env);
      if (photo) return photo;
    }
    const binding = pathname === '/auth' || pathname.startsWith('/auth/') ? env.ADMIN_BACKEND : env.BACKEND;
    return getContainer(binding).fetch(request);
  },
} satisfies ExportedHandler<Env>;
