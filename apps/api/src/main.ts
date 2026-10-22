import 'reflect-metadata';
import { createApplication } from './application.js';
import { loadConfig } from './config.js';
import {
  createConsoleLogger,
  reportListening,
  reportStartupArt,
  reportStartupFailure,
} from './console-display.js';

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  // 初始化异常可能含配置或驱动信息，监听成功前关闭框架输出。
  const app = await createApplication(config, undefined, { logger: false });

  try {
    app.enableShutdownHooks();
    await app.listen(config.port, config.host);
    const url = await app.getUrl();
    const logger = createConsoleLogger();
    app.useLogger(logger);
    reportStartupArt();
    reportListening(url, config.host, logger);
  } catch {
    try {
      await app.close();
    } catch {
      throw new Error('API 启动失败，资源清理未完成。');
    }
    throw new Error('API 启动失败。');
  }
}

if (import.meta.main) {
  bootstrap().catch(() => {
    reportStartupFailure();
    process.exitCode = 1;
  });
}
