const services = [
  { name: 'api', cwd: 'backend' },
  { name: 'web', cwd: 'frontend' },
] as const;

const children = services.map((service) => {
  console.info(`[dev] starting ${service.name}`);
  return Bun.spawn([process.execPath, 'run', 'dev'], {
    cwd: service.cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
});

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const firstExit = await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));
process.exitCode = firstExit;