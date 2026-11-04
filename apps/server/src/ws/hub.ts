import type { ServerMessage } from '@xinoia/shared';

export type Subscriber = (message: ServerMessage) => void;

export class EventHub {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(message: ServerMessage): void {
    for (const subscriber of this.subscribers) subscriber(message);
  }
}
