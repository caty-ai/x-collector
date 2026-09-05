import { describe, expect, it } from "vitest";
import { createSemaphore, SemaphoreQueueFullError } from "../semaphore";

describe("semaphore", () => {
  it("dequeues when aborted between the initial check and listener subscription", async () => {
    const s = createSemaphore(1, 1);
    const release = await s.acquire();
    const controller = new AbortController();
    const reason = { cancelled: "before subscription" };
    const subscribe = controller.signal.addEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args: Parameters<AbortSignal["addEventListener"]>) => {
      controller.abort(reason);
      subscribe(...args);
    };
    await expect(s.acquire(controller.signal)).rejects.toBe(reason);
    expect(s.pending()).toBe(0);
    release();
    expect(s.active()).toBe(0);
  });
  it("honours the limit and transfers a slot", async () => {
    const s = createSemaphore(2, 2);
    const a = await s.acquire();
    const b = await s.acquire();
    const waiting = s.acquire();
    expect([s.active(), s.pending()]).toEqual([2, 1]);
    a();
    const c = await waiting;
    expect([s.active(), s.pending()]).toEqual([2, 0]);
    b(); c();
    expect(s.active()).toBe(0);
  });
  it("rejects a full queue immediately", async () => {
    const s = createSemaphore(1, 1);
    const a = await s.acquire();
    const waiting = s.acquire();
    await expect(s.acquire()).rejects.toBeInstanceOf(SemaphoreQueueFullError);
    expect(s.pending()).toBe(1);
    a(); (await waiting)();
  });
  it("aborts and dequeues with the exact reason, leaving room", async () => {
    const s = createSemaphore(1, 1);
    const a = await s.acquire();
    const controller = new AbortController();
    const reason = { cancelled: true };
    const waiting = s.acquire(controller.signal);
    const rejected = expect(waiting).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(s.pending()).toBe(0);
    const next = s.acquire();
    a(); (await next)();
    expect(s.active()).toBe(0);
  });
  it("makes release idempotent even after handing off", async () => {
    const s = createSemaphore(1, 1);
    const a = await s.acquire();
    const waiting = s.acquire();
    a(); a();
    const b = await waiting;
    expect(s.active()).toBe(1);
    b(); b();
    expect(s.active()).toBe(0);
  });
  it("grants slots in FIFO order", async () => {
    const s = createSemaphore(1, 3);
    const release = await s.acquire();
    const order: number[] = [];
    const tasks = [1, 2, 3].map(async (n) => {
      const done = await s.acquire();
      order.push(n);
      expect(s.active()).toBe(1);
      done();
    });
    release();
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
    expect([s.active(), s.pending()]).toEqual([0, 0]);
  });
  it("rejects pre-aborted acquisition without taking a slot", async () => {
    const s = createSemaphore(1, 0);
    const c = new AbortController(); c.abort();
    await expect(s.acquire(c.signal)).rejects.toBe(c.signal.reason);
    expect(s.active()).toBe(0);
    const release = await s.acquire();
    await expect(s.acquire()).rejects.toBeInstanceOf(SemaphoreQueueFullError);
    release();
  });
  it("removes abort listeners on grant", async () => {
    const s = createSemaphore(1, 1);
    const a = await s.acquire();
    const c = new AbortController();
    const pending = s.acquire(c.signal);
    a();
    const b = await pending;
    c.abort();
    expect([s.active(), s.pending()]).toEqual([1, 0]);
    b();
  });
  it.each([[0, 1], [-1, 1], [1.5, 1], [Infinity, 1], [1, -1], [1, 0.5], [1, Infinity]])("rejects invalid bounds %s/%s", (limit, queue) => {
    expect(() => createSemaphore(limit, queue)).toThrow(RangeError);
  });
});
