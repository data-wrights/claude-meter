import { ExtensionConfig } from "./types";

export class RefreshScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly callback: () => Promise<void>;

  constructor(callback: () => Promise<void>) {
    this.callback = callback;
  }

  start(config: ExtensionConfig): void {
    this.stop();
    const intervalMs = config.refreshIntervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      void this.callback();
    }, intervalMs);
  }

  /** Schedule a one-shot retry after `delayMs`. Cancels any pending retry. */
  scheduleRetry(delayMs: number): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.callback();
    }, delayMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  dispose(): void {
    this.stop();
  }
}
