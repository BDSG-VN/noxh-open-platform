import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  NotificationAutomationService,
  type NotificationAutomationBatch,
} from './notification-automation-service';
import { WorkerBackoff } from './worker-backoff';
@Injectable()
export class NotificationAutomationLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private inFlight: Promise<void> | undefined;
  private last: NotificationAutomationBatch = { claimed: 0, delivered: 0, skipped: 0, failed: 0 };
  private total = 0;
  private readonly backoff = new WorkerBackoff();
  onError = false;
  constructor(
    @Inject(NotificationAutomationService) readonly service: NotificationAutomationService,
  ) {}
  onApplicationBootstrap() {
    // Fail closed for a malformed flag or missing org; one-shot CLI never starts a second loop.
    if (!this.service.configuredOrganization() || process.argv.includes('--notifications-once'))
      return;
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
  }
  tick() {
    if (this.stopped || this.inFlight || !this.backoff.due()) return;
    this.inFlight = this.service
      .runConfiguredBatch(() => !this.stopped)
      .then((value) => {
        this.last = value;
        this.total += value.delivered + value.skipped;
        this.onError = false;
        this.backoff.succeeded();
      })
      .catch((e: unknown) => {
        // Failure class only; messages could carry connection details.
        this.onError = true;
        this.backoff.failed();
        console.error(
          JSON.stringify({
            event: 'notification.automation-batch-failed',
            error: e instanceof Error ? e.name : 'unknown',
          }),
        );
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
  status() {
    return {
      enabled: Boolean(this.service.configuredOrganization()),
      scope: 'synthetic-in-app-application-notifications',
      jobsProcessed: this.total > 0,
      processedCount: this.total,
      lastBatch: this.last,
      error: this.onError,
    };
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
}
