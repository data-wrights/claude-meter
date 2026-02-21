import { ExtensionConfig } from "./types";

export class RefreshScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
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

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stop();
  }
}
