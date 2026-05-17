interface CircuitState {
  failures: number;
  openUntil: number | null;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_RESET_MS = 15 * 60 * 1000;

export class CircuitBreaker {
  private circuits = new Map<string, CircuitState>();
  private threshold: number;
  private resetTimeMs: number;

  constructor(threshold = DEFAULT_THRESHOLD, resetTimeMs = DEFAULT_RESET_MS) {
    this.threshold = threshold;
    this.resetTimeMs = resetTimeMs;
  }

  isOpen(platformId: string): boolean {
    const state = this.circuits.get(platformId);
    if (!state?.openUntil) return false;
    if (Date.now() > state.openUntil) {
      state.openUntil = null;
      return false;
    }
    return true;
  }

  recordSuccess(platformId: string): void {
    this.circuits.set(platformId, { failures: 0, openUntil: null });
  }

  recordFailure(platformId: string): void {
    const state = this.circuits.get(platformId) ?? {
      failures: 0,
      openUntil: null,
    };
    state.failures++;
    if (state.failures >= this.threshold) {
      state.openUntil = Date.now() + this.resetTimeMs;
    }
    this.circuits.set(platformId, state);
  }

  getState(): Record<string, CircuitState> {
    return Object.fromEntries(this.circuits);
  }
}
