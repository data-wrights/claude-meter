"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefreshScheduler = void 0;
class RefreshScheduler {
    timer = null;
    callback;
    constructor(callback) {
        this.callback = callback;
    }
    start(config) {
        this.stop();
        const intervalMs = config.refreshIntervalMinutes * 60 * 1000;
        this.timer = setInterval(() => {
            void this.callback();
        }, intervalMs);
    }
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    dispose() {
        this.stop();
    }
}
exports.RefreshScheduler = RefreshScheduler;
//# sourceMappingURL=refreshScheduler.js.map