import 'reflect-metadata';
import { createApplication } from './application.js';
import { loadConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApplication(config);
  app.enableShutdownHooks();

  try {
    await app.listen(config.port, config.host);
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

bootstrap().catch(() => {
  // Do not print raw startup errors: driver/config errors may include credentials.
  console.error('neobo API failed to start. Check environment settings and port availability.');
  process.exitCode = 1;
});
