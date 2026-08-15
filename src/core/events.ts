import { EventEmitter } from 'node:events';

export type SseEventName = 'status' | 'finding' | 'done';

export interface SseEvent {
  event: SseEventName;
  data: unknown;
}

/**
 * Append-only event log for a job, plus a fan-out emitter for live SSE clients.
 * The log is what makes replay possible: a client connecting to a finished job
 * reads the whole log and gets a byte-identical sequence to a live run.
 */
export class JobEvents {
  readonly log: SseEvent[] = [];
  private readonly emitter = new EventEmitter();
  private ended = false;

  constructor() {
    this.emitter.setMaxListeners(0); // unbounded SSE subscribers
  }

  push(ev: SseEvent): void {
    this.log.push(ev);
    this.emitter.emit('event', ev);
  }

  /** Marks the stream complete; wakes subscribers so they can close. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.emitter.emit('end');
  }

  get isEnded(): boolean {
    return this.ended;
  }

  onEvent(fn: (ev: SseEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  onEnd(fn: () => void): () => void {
    this.emitter.on('end', fn);
    return () => this.emitter.off('end', fn);
  }
}
