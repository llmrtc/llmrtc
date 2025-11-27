import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export interface TestBackendConfig {
  port?: number;
  host?: string;
  localOnly?: boolean;
  env?: Record<string, string>;
}

let backendProcess: ChildProcess | null = null;

/**
 * Start the backend server for testing.
 * Uses ts-node to run the TypeScript source directly.
 */
export async function startTestBackend(config: TestBackendConfig = {}): Promise<void> {
  const {
    port = 8788,
    host = '127.0.0.1',
    localOnly = false,
    env = {},
  } = config;

  if (backendProcess) {
    console.log('[test-backend] Backend already running');
    return;
  }

  return new Promise((resolve, reject) => {
    const backendPath = path.join(PROJECT_ROOT, 'packages', 'backend', 'src', 'index.ts');

    backendProcess = spawn(
      'node',
      ['--loader', 'ts-node/esm', backendPath],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          ...env,
          PORT: String(port),
          HOST: host,
          LOCAL_ONLY: localOnly ? 'true' : 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const timeout = setTimeout(() => {
      reject(new Error('Backend startup timeout'));
    }, 30000);

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      console.log('[test-backend]', output.trim());

      // Backend is ready when it starts listening
      if (output.includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    backendProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[test-backend stderr]', data.toString().trim());
    });

    backendProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    backendProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Backend exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop the test backend server.
 */
export function stopTestBackend(): void {
  if (backendProcess) {
    console.log('[test-backend] Stopping backend');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

/**
 * Check if the backend is healthy.
 */
export async function checkBackendHealth(
  host = '127.0.0.1',
  port = 8788
): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for the backend to be healthy.
 */
export async function waitForBackend(
  host = '127.0.0.1',
  port = 8788,
  timeout = 30000
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await checkBackendHealth(host, port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Backend not healthy after ${timeout}ms`);
}
