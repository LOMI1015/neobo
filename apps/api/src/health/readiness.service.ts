import type { OnApplicationShutdown } from '@nestjs/common';
import type { DependencyProbes } from './dependency-probes.js';

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: {
    postgres: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

export class ReadinessService implements OnApplicationShutdown {
  private inFlight: Promise<ReadinessReport> | undefined;
  private cached: { report: ReadinessReport; expiresAt: number } | undefined;
  private stopping = false;

  constructor(private readonly probes: DependencyProbes) {}

  check(): Promise<ReadinessReport> {
    if (this.stopping) {
      return Promise.resolve({ status: 'not_ready', checks: { postgres: 'down', redis: 'down' } });
    }
    if (this.inFlight) return this.inFlight;
    if (this.cached && this.cached.expiresAt > Date.now())
      return Promise.resolve(this.cached.report);

    // Bound dependency connections even when many viewers poll simultaneously.
    this.inFlight = this.runChecks().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runChecks(): Promise<ReadinessReport> {
    const [postgres, redis] = await Promise.allSettled([
      this.probes.postgres(),
      this.probes.redis(),
    ]);
    const checks = {
      postgres:
        postgres.status === 'fulfilled' && postgres.value ? ('up' as const) : ('down' as const),
      redis: redis.status === 'fulfilled' && redis.value ? ('up' as const) : ('down' as const),
    };
    const report: ReadinessReport = {
      status: checks.postgres === 'up' && checks.redis === 'up' ? 'ready' : 'not_ready',
      checks,
    };
    this.cached = { report, expiresAt: Date.now() + 500 };
    return report;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    // Every short-lived probe closes its own connection before settling.
    await this.inFlight;
  }
}
