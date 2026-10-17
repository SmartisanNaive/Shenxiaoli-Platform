import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../backend/src/db';
import { initializeLocalTesting } from '../backend/src/local-testing';

const root = resolve(import.meta.dir, '..');
const e2e = process.argv.includes('--e2e');
const directory = resolve(root, '.local-test', e2e ? 'e2e' : 'manual');
if (process.argv.includes('--reset'))
  rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true, mode: 0o700 });
const secretFile = resolve(directory, 'session-secret');
if (!existsSync(secretFile))
  writeFileSync(secretFile, randomBytes(48).toString('hex'), { mode: 0o600 });
const databasePath = resolve(directory, 'database.sqlite');
const db = createDatabase({ path: databasePath, seedDemoUsers: true });
initializeLocalTesting(db);
db.close();
const apiPort = e2e ? '8790' : '8788';
const webPort = e2e ? '5176' : '5174';
const env = {
  ...process.env,
  NODE_ENV: 'development',
  LOCAL_TEST_MODE: 'true',
  DEMO_AUTH_ENABLED: 'false',
  RUN_MIGRATIONS: 'false',
  DATABASE_PATH: databasePath,
  UPLOADS_PATH: resolve(directory, 'uploads'),
  SESSION_SECRET: readFileSync(secretFile, 'utf8'),
  BETTER_AUTH_URL: '',
  PORT: apiPort,
  API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
};
const services = [
  { cwd: 'backend', command: [process.execPath, 'run', 'src/index.ts'] },
  { cwd: 'backend', command: [process.execPath, 'run', 'src/worker.ts'] },
  {
    cwd: 'frontend',
    command: [
      process.execPath,
      'run',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      webPort,
      '--strictPort',
    ],
  },
];
console.info(
  `本地测试：http://127.0.0.1:${webPort} · 独立数据目录：${directory}`,
);
console.info('合成邮箱邮件进入本地收件箱；真实邮箱使用配置的 Resend 服务。');
const children = services.map(({ cwd, command }) =>
  Bun.spawn(command, {
    cwd: resolve(root, cwd),
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }),
);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const code = await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));
process.exitCode = code;
