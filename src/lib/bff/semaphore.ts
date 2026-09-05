export class SemaphoreQueueFullError extends Error {
  constructor() {
    super("Semaphore queue is full");
    this.name = "SemaphoreQueueFullError";
  }
}

export function createSemaphore(limit: number, maxQueue: number): {
  acquire(signal?: AbortSignal): Promise<() => void>;
  pending(): number;
  active(): number;
} {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxQueue) || maxQueue < 0) {
    throw new RangeError("Expected a positive integer limit and a non-negative integer maxQueue");
  }

  type Waiter = {
    resolve: (release: () => void) => void;
    cleanup: () => void;
  };
  const queue: Waiter[] = [];
  let activeCount = 0;

  function releaseHandle(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) {
        next.cleanup();
        next.resolve(releaseHandle());
      } else {
        activeCount -= 1;
      }
    };
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (activeCount < limit) {
        activeCount += 1;
        return Promise.resolve(releaseHandle());
      }
      if (queue.length >= maxQueue) return Promise.reject(new SemaphoreQueueFullError());
      return new Promise<() => void>((resolve, reject) => {
        const onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index === -1) return;
          queue.splice(index, 1);
          waiter.cleanup();
          reject(signal?.reason);
        };
        const waiter: Waiter = {
          resolve,
          cleanup: () => signal?.removeEventListener("abort", onAbort),
        };
        queue.push(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    },
    pending: () => queue.length,
    active: () => activeCount,
  };
}
