#!/usr/bin/env node
/* global console, process */
/**
 * Cloudflare Workers Builds deploy command. Configure it in the Cloudflare
 * dashboard as:
 *   node scripts/deploy-ci.mjs production      (main branch build)
 *   node scripts/deploy-ci.mjs dev             (develop branch build)
 *
 * dev deploys immediately. production only uploads a Worker version; promoting
 * that version remains a deliberate manual action in the Cloudflare dashboard.
 * Keeping this as Node rather than POSIX shell also makes the workspace deploy
 * commands usable from Windows development environments.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [environment, ...extraArgs] = process.argv.slice(2);
if (environment !== 'dev' && environment !== 'production') {
  console.error('usage: node scripts/deploy-ci.mjs <production|dev> [wrangler args...]');
  process.exit(1);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const sha = (process.env.WORKERS_CI_COMMIT_SHA ?? 'unknown').slice(0, 7);

let subject = `build ${sha}`;
try {
  subject =
    execFileSync('git', ['log', '-1', '--pretty=%s'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim() || subject;
} catch {
  // A source archive or dry-run outside a Git checkout still produces a
  // readable Cloudflare version message.
}

const wranglerArgs = [
  resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js'),
  ...(environment === 'dev' ? ['deploy'] : ['versions', 'upload']),
  '--config',
  'packages/bridge-worker/wrangler.jsonc',
  '--env',
  environment,
  '--tag',
  `v${version}-${sha}`,
  '--message',
  subject,
  '--define',
  `__APP_VERSION__:"${version}"`,
  '--define',
  `__APP_COMMIT__:"${sha}"`,
  ...extraArgs,
];

const result = spawnSync(process.execPath, wranglerArgs, {
  cwd: repositoryRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
