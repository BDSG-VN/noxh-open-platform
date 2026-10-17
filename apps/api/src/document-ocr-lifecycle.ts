import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DocumentOcrService, emptyOcrMetrics, type OcrMetrics } from './document-ocr-service';
/** Worker loop for self-hosted OCR jobs; same fail-closed rules as the delivery lifecycle. */
@Injectable()
export class DocumentOcrLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private inFlight: Promise<void> | undefined;
  private last: OcrMetrics = emptyOcrMetrics();
  onError = false;
  constructor(@Inject(DocumentOcrService) readonly service: DocumentOcrService) {}
  onApplicationBootstrap() {
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
        this.onError = false;
      })
      .catch((e: unknown) => {
        // Surface the failure class only; messages could carry connection or path details.
        this.onError = true;
        console.error(
          JSON.stringify({
            event: 'document.ocr-batch-failed',
            error: e instanceof Error ? e.name : 'unknown',
          }),
        );
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }
  /** Counters only: no identifiers or document content on the health endpoint. */
  status() {
    return {
      enabled: Boolean(this.service.configuredOrganization()),
      scope: 'self-hosted-document-ocr',
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
