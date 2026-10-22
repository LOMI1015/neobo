import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from './application.js';
import { loadConfig } from './config.js';
import { reportListening, reportStartupArt, reportStartupFailure } from './console-display.js';
import { createRuntimeLogging } from './logging.js';
import type { RuntimeLogging } from './logging.js';

export async function bootstrap(): Promise<void> {
  let app: NestFastifyApplication | undefined;
  let logging: RuntimeLogging | undefined;

  try {
    logging = createRuntimeLogging();
    const runtimeLogging = logging;
    const config = loadConfig();
    app = await createApplication(config, undefined, { logging });
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onClose', async () => {
      runtimeLogging.write('info', 'server.stopped');
      await runtimeLogging.close();
    });
    app.enableShutdownHooks();
    await app.listen(config.port, config.host);
    const url = await app.getUrl();
    reportStartupArt();
    reportListening(url, config.host, logging);
  } catch {
    // 配置和框架异常可能含凭据，只输出受控事件，再释放已创建的资源。
    if (logging) {
      logging.write('fatal', 'server.startup_failed', { errorCode: 'STARTUP_FAILED' });
    } else {
      reportStartupFailure();
    }
    let cleanupFailed = false;
    try {
      await app?.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      await logging?.close();
    } catch {
      cleanupFailed = true;
    }
    throw new Error(cleanupFailed ? 'API 启动失败，资源清理未完成。' : 'API 启动失败。');
  }
}

if (import.meta.main) {
  bootstrap().catch(() => {
    process.exitCode = 1;
  });
}
