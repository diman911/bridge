import { generateKeyPairSync } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(__dirname, '../..');
const controlPlaneRoot = path.resolve(
  process.env.CP_REPO_PATH ?? path.resolve(bridgeRoot, '../control-plane'),
);
const cpPort = Number(process.env.CP_E2E_PORT ?? 8787);
const bridgePort = Number(process.env.BRIDGE_E2E_PORT ?? 18887);

export const controlPlaneUrl = `http://127.0.0.1:${cpPort}`;
export const bridgeUrl = `http://127.0.0.1:${bridgePort}`;

export interface GithubE2eSeed {
  projectId: string;
  sessionToken: string;
  bridgeIdentityToken: string;
  expiredBridgeIdentityToken: string;
  githubIntegrationInstanceId: string;
  githubOwner: string;
  githubRepo: string;
}

interface ManagedProcess {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
}

export interface GithubE2eServers {
  seed: GithubE2eSeed;
  diagnostics(): string;
  stop(): Promise<void>;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => server.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

async function waitFor(
  url: string,
  timeoutMs: number,
  processInfo?: ManagedProcess,
): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const details = processInfo
    ? `\n--- stdout ---\n${processInfo.stdout()}\n--- stderr ---\n${processInfo.stderr()}`
    : '';
  throw new Error(`Server did not become ready: ${url}; ${String(lastError)}${details}`);
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // The process may already have exited.
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The process may already have exited.
    }
  }
}

function startProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ManagedProcess {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'pipe',
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return { child, stdout: () => stdout, stderr: () => stderr };
}

function nodeModuleBin(root: string, packageName: string): string {
  const bin = path.join(
    root,
    'node_modules',
    packageName,
    packageName === 'tsx' ? 'dist/cli.mjs' : 'bin/wrangler.js',
  );
  if (!fs.existsSync(bin)) throw new Error(`Missing ${packageName} CLI at ${bin}`);
  return bin;
}

function runSeed(env: NodeJS.ProcessEnv): GithubE2eSeed {
  const tsx = nodeModuleBin(controlPlaneRoot, 'tsx');
  const output = execFileSync(process.execPath, [tsx, 'scripts/seed-e2e.ts'], {
    cwd: controlPlaneRoot,
    env,
    encoding: 'utf8',
  });
  const line = output.split('\n').find((value) => value.startsWith('E2E_SEED_DATA '));
  if (!line) throw new Error(`seed-e2e.ts produced no E2E_SEED_DATA line:\n${output}`);
  const seed = JSON.parse(line.slice('E2E_SEED_DATA '.length)) as Partial<GithubE2eSeed>;
  if (
    typeof seed.projectId !== 'string' ||
    typeof seed.sessionToken !== 'string' ||
    typeof seed.bridgeIdentityToken !== 'string' ||
    typeof seed.expiredBridgeIdentityToken !== 'string' ||
    typeof seed.githubIntegrationInstanceId !== 'string' ||
    typeof seed.githubOwner !== 'string' ||
    typeof seed.githubRepo !== 'string'
  ) {
    throw new Error(`seed-e2e.ts did not return the GitHub fixture:\n${line}`);
  }
  return seed as GithubE2eSeed;
}

function makeGlobalSigningKeypair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function addGlobalSigningKeys(privateKeyPem: string, publicKeyPem: string): () => void {
  const varsPath = path.join(controlPlaneRoot, '.dev.vars');
  const marker = '\n# Bridge E2E temporary signing keys\n';
  const original = fs.existsSync(varsPath) ? fs.readFileSync(varsPath, 'utf8') : null;
  const suffix = `${marker}GLOBAL_SIGNING_PRIVATE_KEY="${privateKeyPem}"\nGLOBAL_SIGNING_PUBLIC_KEY="${publicKeyPem}"\n`;
  fs.writeFileSync(
    varsPath,
    `${original ?? ''}${original && !original.endsWith('\n') ? '\n' : ''}${suffix}`,
  );
  return () => {
    if (original === null) fs.rmSync(varsPath, { force: true });
    else fs.writeFileSync(varsPath, original);
  };
}

function resetControlPlaneDatabase(env: NodeJS.ProcessEnv): void {
  const tsx = nodeModuleBin(controlPlaneRoot, 'tsx');
  execFileSync(process.execPath, [tsx, 'scripts/reset-local-d1.ts'], {
    cwd: controlPlaneRoot,
    env,
    stdio: 'inherit',
  });
}

export async function startGithubE2e(): Promise<GithubE2eServers> {
  const token = process.env.BRIDGE_E2E_GITHUB_TOKEN;
  const owner = process.env.BRIDGE_E2E_GITHUB_OWNER;
  const repo = process.env.BRIDGE_E2E_GITHUB_REPO;
  if (!token || !owner || !repo) {
    throw new Error(
      'BRIDGE_E2E_GITHUB_TOKEN, BRIDGE_E2E_GITHUB_OWNER, and BRIDGE_E2E_GITHUB_REPO are required',
    );
  }
  if (!fs.existsSync(path.join(controlPlaneRoot, 'wrangler.toml')))
    throw new Error(`Control Plane checkout not found at ${controlPlaneRoot}`);
  for (const port of [cpPort, bridgePort]) {
    if (!(await isPortFree(port))) throw new Error(`Port ${port} is already in use`);
  }

  const commonEnv = { ...process.env };
  const keypair = makeGlobalSigningKeypair();
  const restoreControlPlaneVars = addGlobalSigningKeys(keypair.privateKeyPem, keypair.publicKeyPem);
  const seedEnv = {
    ...commonEnv,
    CP_E2E_URL: controlPlaneUrl,
    BRIDGE_E2E_URL: bridgeUrl,
    BRIDGE_E2E_GLOBAL_SIGNING_PRIVATE_KEY: keypair.privateKeyPem,
    BRIDGE_E2E_GITHUB_TOKEN: token,
    BRIDGE_E2E_GITHUB_OWNER: owner,
    BRIDGE_E2E_GITHUB_REPO: repo,
  };
  const frontendIndexHtml = path.join(controlPlaneRoot, 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(frontendIndexHtml)) {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: controlPlaneRoot,
      env: commonEnv,
      stdio: 'inherit',
    });
  }
  resetControlPlaneDatabase(seedEnv);
  const seed = runSeed(seedEnv);
  const wrangler = nodeModuleBin(controlPlaneRoot, 'wrangler');
  const cp = startProcess(
    process.execPath,
    [wrangler, 'dev', '--port', String(cpPort)],
    controlPlaneRoot,
    commonEnv,
  );
  try {
    await waitFor(`${controlPlaneUrl}/health`, 30_000, cp);
    const bridge = startProcess(
      process.execPath,
      [nodeModuleBin(bridgeRoot, 'wrangler'), 'dev', '--local', '--port', String(bridgePort)],
      path.join(bridgeRoot, 'packages', 'bridge-worker'),
      commonEnv,
    );
    try {
      await waitFor(`${bridgeUrl}/health`, 30_000, bridge);
      return {
        seed,
        diagnostics: () =>
          `--- Bridge stdout ---\n${bridge.stdout()}\n--- Bridge stderr ---\n${bridge.stderr()}\n--- CP stdout ---\n${cp.stdout()}\n--- CP stderr ---\n${cp.stderr()}`,
        stop: () => {
          killTree(bridge.child.pid);
          killTree(cp.child.pid);
          restoreControlPlaneVars();
          return Promise.resolve();
        },
      };
    } catch (error) {
      killTree(bridge.child.pid);
      restoreControlPlaneVars();
      throw error;
    }
  } catch (error) {
    killTree(cp.child.pid);
    restoreControlPlaneVars();
    throw error;
  }
}
