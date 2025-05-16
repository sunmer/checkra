import { type AiSettings as CoreAiSettings } from '../ui/settings-modal'; // ADDED: Import for CoreAiSettings

type Listener = (...args: any[]) => void;

export interface EventTypes {
  'settingsChanged': CoreAiSettings;
  'toggleViewerShortcut': void; // ADDED: For global shortcut toggle
  'showViewerApi': void; // ADDED: For programmatic show from API
  'viewerDidShow': void; // ADDED: Emitted after viewer becomes visible
  'viewerDidHide': void; // ADDED: Emitted after viewer becomes hidden

  // --- ADDED: DALL-E Image Events ---
  'dalleImageLoading': { placeholderId: string; prompt: string; size?: string };
  'dalleImageLoaded': { placeholderId: string; prompt: string; size?: string; url: string };
  'dalleImageError': { placeholderId: string; prompt: string; size?: string; error: string };
  'dalleImageRegenerate': { placeholderId: string; prompt: string; size?: string };
  // --- END ADDED ---
}

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