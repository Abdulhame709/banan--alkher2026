/**
 * Deploy the built SPA in ./dist to Netlify using the REST API.
 *
 * Uses the token that `netlify login` stores locally, so no secret is ever
 * printed. Files are uploaded individually with SHA-1 digests instead of a zip,
 * because Windows zip writers store backslash separators that Netlify would
 * treat as literal file names.
 *
 * Usage:
 *   node scripts/deploy-netlify.mjs [site-name]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.netlify.com/api/v1';
const DIST = path.resolve('dist');
const SITE_NAME = process.argv[2] || 'banan-fund';

function readToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  const candidates = [
    path.join(process.env.APPDATA || '', 'netlify', 'Config', 'config.json'),
    path.join(os.homedir(), '.netlify', 'config.json'),
    path.join(process.env.LOCALAPPDATA || '', 'netlify', 'Config', 'config.json'),
  ];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      const users = config.users || {};
      for (const key of Object.keys(users)) {
        const token = users[key]?.auth?.token;
        if (token) return token;
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('Netlify token not found. Run: netlify login');
}

const token = readToken();

async function api(method, suffix, body, contentType = 'application/json') {
  const response = await fetch(`${API}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': contentType } : {}),
    },
    body,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${suffix} -> ${response.status} ${String(text).slice(0, 300)}`);
  }
  return data;
}

async function ensureSite() {
  const sites = await api('GET', '/sites?per_page=100');
  const existing = (sites || []).find((site) => site.name === SITE_NAME);
  const site = existing ?? (await api('POST', '/sites', JSON.stringify({ name: SITE_NAME })));
  // New sites inherit the team's "require login" setting, which makes every
  // visitor hit a Netlify login screen. Turn it off for a public fund app.
  if (site.sso_login) {
    return await api('PATCH', `/sites/${site.id}`, JSON.stringify({ sso_login: false }));
  }
  return site;
}

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else out.push({ full, rel });
  }
  return out;
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('dist/index.html is missing. Run: npm run build');
  }
  const site = await ensureSite();
  console.log(`site: ${site.name} (${site.id})`);

  const files = walk(DIST).map((file) => {
    const bytes = fs.readFileSync(file.full);
    return {
      ...file,
      bytes,
      sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
    };
  });

  const manifest = {};
  for (const file of files) manifest[`/${file.rel}`] = file.sha1;

  let deploy = await api('POST', `/sites/${site.id}/deploys`, JSON.stringify({ files: manifest }));
  console.log(`deploy: ${deploy.id}`);

  // `required` contains the SHA-1 digests of blobs Netlify does not have yet,
  // and files are uploaded by digest, not by path. Several paths may share a
  // digest, so build a digest -> bytes map and upload each digest once.
  const bySha = new Map();
  for (const file of files) {
    if (!bySha.has(file.sha1)) bySha.set(file.sha1, file);
  }
  const required = Array.isArray(deploy.required) && deploy.required.length
    ? deploy.required.map((entry) => String(entry))
    : [...bySha.keys()];
  const uploads = required.filter((sha) => bySha.has(sha));
  console.log(`files: ${files.length} total, ${uploads.length} blobs to upload`);

  let uploaded = 0;
  for (const sha of uploads) {
    await api(
      'PUT',
      `/deploys/${deploy.id}/files/${encodeURIComponent(sha)}`,
      bySha.get(sha).bytes,
      'application/octet-stream'
    );
    uploaded += 1;
    if (uploaded % 10 === 0) process.stdout.write(`  ${uploaded}/${uploads.length}\r`);
  }
  console.log(`  uploaded ${uploaded}/${uploads.length}`);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    deploy = await api('GET', `/deploys/${deploy.id}`);
    if (deploy.state === 'ready' || deploy.state === 'error') break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    process.stdout.write(`  ${deploy.state}\r`);
  }
  console.log(`\nfinal state: ${deploy.state}`);
  if (deploy.state !== 'ready') {
    console.error(deploy.error_message || 'deploy did not become ready');
    process.exit(1);
  }
  console.log(`url: ${site.ssl_url || site.url}`);
}

main().catch((error) => {
  console.error('ERROR', error.message);
  process.exit(1);
});
