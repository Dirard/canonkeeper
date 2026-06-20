import { createMockApiServer } from './server';

const host = process.env.MOCK_API_HOST ?? '127.0.0.1';
const port = Number(process.env.MOCK_API_PORT ?? '8787');

const controller = createMockApiServer({
  host,
  port,
  logger(event) {
    process.stdout.write(
      `[mock-api] ${event.requestId} ${event.method} ${event.path} ${event.status} ${event.operationId ?? '-'} ${event.durationMs}ms\n`,
    );
  },
});

const started = await controller.start();
process.stdout.write(`[mock-api] listening ${started.url}/api/v1\n`);

async function shutdown() {
  await controller.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
