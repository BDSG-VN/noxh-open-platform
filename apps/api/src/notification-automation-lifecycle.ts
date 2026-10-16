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
@Injectable()
export class NotificationAutomationLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private inFlight: Promise<void> | undefined;
  private last: NotificationAutomationBatch = { claimed: 0, delivered: 0, skipped: 0, failed: 0 };
  private total = 0;
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
    if (this.stopped || this.inFlight) return;
    this.inFlight = this.service
      .runConfiguredBatch(() => !this.stopped)
      .then((value) => {
        this.last = value;
        this.total += value.delivered + value.skipped;
        this.onError = false;
      })
      .catch(() => {
        this.onError = true;
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
