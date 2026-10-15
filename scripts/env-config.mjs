// Resolves every setting of one environment (dev / prod) of the stack and prints them as
// key=value lines, ready for $GITHUB_OUTPUT. Used by provision.yml, power.yml and the it-*.yml
// workflows, so they all agree on names and URLs.
//
// GitHub variables are looked up as <ENV>_<NAME> first (DEV_CLOUDFLARE_ACCOUNT_ID,
// PROD_URL, ...), then as the plain <NAME>. Secrets follow the same rule in the workflows.
//
// Resource names: dev keeps the stack's original names; other environments get a suffix, so
// dev and prod can share one Cloudflare account or live in separate ones.
//
// Custom hostnames come from <ENV>_URL (a hostname in a Cloudflare zone of that environment's
// account; a scheme, path or port is ignored) and stay one level below the zone, so the free
// Universal SSL certificate covers them:
//
//            URL = zone (majdabbas.dev)    URL = sub.zone (dev.majdabbas.dev)
//   site     majdabbas.dev                 dev.majdabbas.dev
//   admin    admin.majdabbas.dev           dev-admin.majdabbas.dev
//   api      api.majdabbas.dev             dev-api.majdabbas.dev
//   images   images.majdabbas.dev          dev-images.majdabbas.dev  (public R2 CDN)
//
// <ENV>_URL unset = no custom domains: the API is reached on workers.dev, the sites on pages.dev.
//
// Env: ENV_NAME (dev|prod), VARS_JSON (${{ toJSON(vars) }}), CLOUDFLARE_API_TOKEN
//      (Zone: Read, Workers Scripts: Read). SKIP_LOOKUPS=true prints only the names (no API calls).

const DEFAULTS = {
  dev: {
    worker: 'prket-alandlos-api',
    site_project: 'prket-alandlos-site',
    admin_project: 'prket-alandlos-admin',
    r2_bucket: 'prket-andlos',
    state_key: 'storage/terraform.tfstate',
    gh_environment: 'dev',
    seed_samples: 'true',
  },
  prod: {
    worker: 'prket-alandlos-api-prod',
    site_project: 'prket-alandlos-site-prod',
    admin_project: 'prket-alandlos-admin-prod',
    r2_bucket: 'prket-andlos-prod',
    state_key: 'prod/storage/terraform.tfstate',
    gh_environment: 'production',
    // A fresh production catalogue starts empty instead of with the sample products
    seed_samples: 'false',
  },
};
const STATE_BUCKET = 'prket-terraform-state';

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const envName = (process.env.ENV_NAME || 'dev').toLowerCase();
if (!DEFAULTS[envName]) die(`Unknown environment "${envName}" (expected: ${Object.keys(DEFAULTS).join(', ')})`);
const vars = JSON.parse(process.env.VARS_JSON || '{}');

// <ENV>_NAME, then NAME
const get = (name, env = envName) => vars[`${env.toUpperCase()}_${name}`] || vars[name] || '';
const required = (name, env = envName) =>
  get(name, env) || die(`Missing GitHub variable ${env.toUpperCase()}_${name} (or ${name})`);
const hostOf = (url) =>
  url.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '').toLowerCase();

const d = DEFAULTS[envName];
const out = {
  env: envName,
  // Prefix of this environment's GitHub variables and secrets
  prefix: envName.toUpperCase(),
  gh_environment: d.gh_environment,
  account_id: required('CLOUDFLARE_ACCOUNT_ID'),
  database_id: required('CLOUDFLARE_DATABASE_ID'),
  // The plain R2_BUCKET_NAME predates environments and names dev's bucket
  r2_bucket: vars[`${envName.toUpperCase()}_R2_BUCKET_NAME`] || (envName === 'dev' && vars.R2_BUCKET_NAME) || d.r2_bucket,
  state_bucket: get('TF_STATE_BUCKET') || STATE_BUCKET,
  state_key: d.state_key,
  worker: d.worker,
  site_project: d.site_project,
  admin_project: d.admin_project,
  seed_samples: d.seed_samples,
  // Containers (deploy job). *_IMAGE_TAG: a tag the backend repo pushed to this account's
  // Cloudflare registry (sha-<short sha> or latest); empty = the image of that repo's last
  // successful publish run. *_INSTANCE: an instance type (lite, basic, standard-1..4) or custom
  // JSON {"vcpu":0.5,"memory_mib":2048,"disk_mb":4000}; empty = the one in wrangler.jsonc.
  backend_image_tag: get('BACKEND_IMAGE_TAG'),
  admin_backend_image_tag: get('ADMIN_BACKEND_IMAGE_TAG'),
  backend_instance: get('BACKEND_INSTANCE'),
  admin_backend_instance: get('ADMIN_BACKEND_INSTANCE'),
};

// Environments in the same Cloudflare account must not share data
for (const other of Object.keys(DEFAULTS).filter((e) => e !== envName)) {
  if (get('CLOUDFLARE_ACCOUNT_ID', other) !== out.account_id) continue;
  if (get('CLOUDFLARE_DATABASE_ID', other) === out.database_id)
    die(`${envName} and ${other} use the same D1 database (${out.database_id}): set ${envName.toUpperCase()}_CLOUDFLARE_DATABASE_ID`);
  const theirBucket = vars[`${other.toUpperCase()}_R2_BUCKET_NAME`] || (other === 'dev' && vars.R2_BUCKET_NAME) || DEFAULTS[other].r2_bucket;
  if (theirBucket === out.r2_bucket)
    die(`${envName} and ${other} use the same R2 bucket (${out.r2_bucket}): set ${envName.toUpperCase()}_R2_BUCKET_NAME`);
}

const site = hostOf(get('URL'));
if (process.env.SKIP_LOOKUPS !== 'true') {
  const token = process.env.CLOUDFLARE_API_TOKEN || die('CLOUDFLARE_API_TOKEN is not set');
  const cf = async (path) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!body.success) die(`Cloudflare API ${path} failed (HTTP ${res.status}): ${JSON.stringify(body.errors)}`);
    return body.result;
  };

  if (site) {
    // The zone is the longest suffix of the URL that is a zone in this account
    let zone;
    for (let name = site; name.includes('.') && !zone; name = name.slice(name.indexOf('.') + 1)) {
      [zone] = await cf(`/zones?name=${name}&account.id=${out.account_id}`);
    }
    if (!zone)
      die(
        `No Cloudflare zone in account ${out.account_id} contains ${site} - or ${out.prefix}_CLOUDFLARE_API_TOKEN ` +
          `can't see it (token needs Zone > Zone: Read, DNS: Edit, Workers Routes: Edit on that zone)`,
      );

    const prefix = site === zone.name ? '' : `${site.slice(0, -zone.name.length - 1).replaceAll('.', '-')}-`;
    Object.assign(out, {
      zone_id: zone.id,
      site,
      admin: `${prefix}admin.${zone.name}`,
      api: `${prefix}api.${zone.name}`,
      images: `${prefix}images.${zone.name}`,
    });
    out.api_url = `https://${out.api}`;

    // Never take over another environment's hostnames
    for (const other of Object.keys(DEFAULTS).filter((e) => e !== envName)) {
      const theirs = hostOf(get('URL', other));
      if (!theirs) continue;
      const taken = [theirs, `admin.${theirs}`, `api.${theirs}`, `images.${theirs}`];
      const clash = [out.site, out.admin, out.api, out.images].find((h) => taken.includes(h));
      if (clash) die(`${envName} hostname ${clash} collides with ${other} (${theirs}): change ${envName.toUpperCase()}_URL`);
    }
  } else {
    const { subdomain } = await cf(`/accounts/${out.account_id}/workers/subdomain`);
    out.api_url = `https://${out.worker}.${subdomain}.workers.dev`;
  }
}

for (const [key, value] of Object.entries(out)) console.log(`${key}=${value ?? ''}`);
