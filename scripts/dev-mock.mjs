import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'mock:api'], {
    env: { ...process.env, MOCK_API_HOST: process.env.MOCK_API_HOST ?? '127.0.0.1', MOCK_API_PORT: process.env.MOCK_API_PORT ?? '8787' },
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn(npmCommand, ['run', 'dev'], {
    env: { ...process.env, MOCK_API_TARGET: process.env.MOCK_API_TARGET ?? 'http://127.0.0.1:8787' },
    stdio: 'inherit',
    windowsHide: true,
  }),
];

let shuttingDown = false;

function stopAll(code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on('exit', (code) => {
    stopAll(code ?? 0);
  });
  child.on('error', () => {
    stopAll(1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
