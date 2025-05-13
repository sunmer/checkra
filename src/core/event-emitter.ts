type Listener = (...args: any[]) => void;

export class EventEmitter {
  private events: Map<string, Listener[]> = new Map();

  public on(event: string, listener: Listener): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);

    // Return an unsubscribe function
    return () => this.off(event, listener);
  }

  public off(event: string, listenerToRemove: Listener): void {
    if (!this.events.has(event)) {
      return;
    }

    const listeners = this.events.get(event)!;
    this.events.set(event, listeners.filter(listener => listener !== listenerToRemove));
  }

  public emit(event: string, ...args: any[]): void {
    if (!this.events.has(event)) {
      return;
    }
    this.events.get(event)!.forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  public once(event: string, listener: Listener): () => void {
    const remove = this.on(event, (...args) => {
      remove(); // Unsubscribe after first call
      listener(...args);
    });
    return remove; 
  }
} 