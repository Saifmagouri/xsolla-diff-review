import { config } from '../config';

/**
 * Fixed-concurrency task runner. Up to `limit` tasks run at once; further tasks
 * wait in a FIFO queue (their jobs sit in `queued`) and start as slots free.
 * A submitted task is never rejected — the 5th job queues safely.
 */
export class Scheduler {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  submit(task: () => Promise<unknown>): void {
    const start = () => {
      this.running++;
      Promise.resolve()
        .then(task)
        .catch(() => {
          /* pipeline handles its own errors; never surface here */
        })
        .finally(() => {
          this.running--;
          const next = this.queue.shift();
          if (next) next();
        });
    };
    if (this.running < this.limit) start();
    else this.queue.push(start);
  }

  get activeCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}

export const scheduler = new Scheduler(config.limits.maxConcurrentJobs);
