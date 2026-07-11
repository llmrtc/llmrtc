/**
 * Async bridge between callback-style event sources (e.g. WebSocket
 * message handlers) and an async generator: events are pushed as they
 * arrive and pulled by the consumer.
 *
 * Semantics:
 * - Items buffered before end()/fail() are always delivered first.
 * - end() after fail() and fail() after end() are no-ops.
 * - push() after end()/fail() is dropped.
 * - fail() surfaces to the consumer as a throw on its next pull.
 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private rejecter: ((err: Error) => void) | null = null;
  private ended = false;
  private error: Error | null = null;

  push(item: T): void {
    if (this.ended || this.error) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      this.rejecter = null;
      w({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  end(): void {
    if (this.ended || this.error) return;
    this.ended = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      this.rejecter = null;
      w({ value: undefined as T, done: true });
    }
  }

  fail(err: Error): void {
    if (this.ended || this.error) return;
    this.error = err;
    if (this.rejecter) {
      const r = this.rejecter;
      this.waiter = null;
      this.rejecter = null;
      r(err);
    }
  }

  /** True once end() or fail() has been called. */
  get done(): boolean {
    return this.ended || this.error !== null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
        continue;
      }
      if (this.error) throw this.error;
      if (this.ended) return;
      const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiter = resolve;
        this.rejecter = reject;
      });
      if (result.done) return;
      yield result.value;
    }
  }
}
