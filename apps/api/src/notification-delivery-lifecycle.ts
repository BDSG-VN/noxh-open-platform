import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  NotificationDeliveryService,
  emptyDeliveryMetrics,
  type NotificationDeliveryMetrics,
} from './notification-delivery-service';
import { WorkerBackoff } from './worker-backoff';
/** Worker loop for external deliveries; identical fail-closed rules to the automation lifecycle. */
@Injectable()
export class NotificationDeliveryLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private inFlight: Promise<void> | undefined;
  private last: NotificationDeliveryMetrics = emptyDeliveryMetrics();
  private readonly backoff = new WorkerBackoff();
  onError = false;
  constructor(@Inject(NotificationDeliveryService) readonly service: NotificationDeliveryService) {}
  onApplicationBootstrap() {
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
        this.onError = false;
        this.backoff.succeeded();
      })
      .catch((e: unknown) => {
        // Surface the failure class only; messages could carry connection or provider details.
        this.onError = true;
        this.backoff.failed();
        console.error(
          JSON.stringify({
            event: 'notification.delivery-batch-failed',
            error: e instanceof Error ? e.name : 'unknown',
          }),
        );
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
  /** Counters only: no identifiers, addresses or content on the health endpoint. */
  status() {
    return {
      enabled: Boolean(this.service.configuredOrganization()),
      scope: 'synthetic-external-notification-delivery',
      counters: { ...this.service.metrics },
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
