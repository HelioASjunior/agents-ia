/**
 * Fila por chave: quem pede uma chave ocupada espera a vez, na ordem de chegada.
 * As chaves são sempre adquiridas em ordem alfabética, o que evita impasse quando
 * um trabalho precisa de várias, como o agente e um editor compartilhado.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(keys: string[]): Promise<() => void> {
    const releases: Array<() => void> = [];
    for (const key of [...new Set(keys)].sort()) {
      const previous = this.tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      const tail = previous.then(() => current);
      this.tails.set(key, tail);
      releases.push(() => {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
      await previous;
    }
    return () => {
      for (const release of releases) release();
    };
  }
}
