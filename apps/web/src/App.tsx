import { useEffect, useState } from 'react';

type HealthState = { status: 'pending' } | { status: 'ok' } | { status: 'error'; message: string };

const requestTimeoutMs = 8_000;

function isHealthy(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'status' in value && value.status === 'ok';
}

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'pending' });
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`API 服务返回 HTTP ${response.status}。`);
        }

        const body: unknown = await response.json();

        if (!isHealthy(body)) {
          throw new Error('API 服务返回了无法识别的健康状态。');
        }

        if (active) {
          setHealth({ status: 'ok' });
        }
      } catch (error: unknown) {
        if (active) {
          setHealth({
            status: 'error',
            message: controller.signal.aborted
              ? '连接超时，请确认 API 服务已启动。'
              : error instanceof Error
                ? error.message
                : '无法连接 API 服务，请检查服务与代理配置。',
          });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkHealth();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [requestRevision]);

  function retryHealth() {
    setHealth({ status: 'pending' });
    setRequestRevision((revision) => revision + 1);
  }

  return (
    <main className="page">
      <header className="page-header">
        <a className="wordmark" href="/" aria-label="neobo 首页">
          neobo
        </a>
        <span className="environment-label">本地开发</span>
      </header>

      <section className="introduction" aria-labelledby="page-title">
        <p className="eyebrow">从一张白板开始</p>
        <h1 id="page-title">开发环境</h1>
        <p>前端应用已启动。在这里确认服务连接，准备开始开发。</p>
      </section>

      <section className="status-panel" aria-labelledby="service-title">
        <div className="panel-heading">
          <h2 id="service-title">API 服务</h2>
          <code>/api/health</code>
        </div>

        <div className={`service-status service-status--${health.status}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            {health.status === 'pending' && '正在连接…'}
            {health.status === 'ok' && '服务已连接'}
            {health.status === 'error' && '连接失败'}
          </span>
        </div>

        {health.status === 'error' && <p className="error-detail">{health.message}</p>}
        <p className="help-text">仅确认 API 服务可达，数据库和 Redis 的就绪情况由后端单独检查。</p>
        <button type="button" onClick={retryHealth} disabled={health.status === 'pending'}>
          {health.status === 'pending'
            ? '检查中…'
            : health.status === 'error'
              ? '重试连接'
              : '重新检查'}
        </button>
      </section>

      <section className="next-steps" aria-labelledby="next-title">
        <h2 id="next-title">接下来构建</h2>
        <p>当前仅提供开发骨架，以下能力尚未实现。</p>
        <ul>
          <li>原子元素与自由场景编辑</li>
          <li>AI 对话搭建与局部修改</li>
          <li>独立主题包、三维场景与动画</li>
        </ul>
      </section>
    </main>
  );
}
