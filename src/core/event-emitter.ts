import { AiSettings } from '../types';
import { AddRatingRequestBody } from '../types';

type Listener = (...args: any[]) => void;

export type EventName =
  | 'settingsChanged'
  | 'aiRequestSent'
  | 'aiResponseChunk'
  | 'aiFinalized'
  | 'aiError'
  | 'aiUserMessage'
  | 'toggleViewerShortcut'
  | 'showViewerRequest'      // Programmatic request to show the viewer
  | 'hideViewerRequest'      // Programmatic request to hide the viewer
  | 'viewerWillShow'         // Emitted by UI just before showing
  | 'viewerDidShow'          // Emitted by UI after it has become visible
  | 'viewerWillHide'         // Emitted by UI just before hiding
  | 'viewerDidHide'          // Emitted by UI after it has become hidden
  | 'feedbackViewerImplReady'
  | 'screenshotTaken'        // Added for screenshot data
  | 'elementSelected'        // Added for element selection
  | 'elementDeselected'     // Added for element deselection
  | 'fixRated'
  | 'aiJsonPatch' // Added for JSON patch data
  | 'aiDomUpdateReceived' // Added for direct DOM updates
  | 'aiThinking'
  | 'aiThinkingDone';

/**
 * Defines the payload types for each event.
 * Uses 'void' if an event does not carry a payload.
 */
export interface EventPayloads {
  'settingsChanged': AiSettings;
  'aiRequestSent': { prompt: string; imageDataUrl?: string | null; context?: string | null, selectedElementSelector?: string | null, originalHtml?: string | null, fixId?: string | null };
  'aiResponseChunk': string;
  'aiFinalized': void;
  'aiError': Error | string;
  'aiUserMessage': string;
  'toggleViewerShortcut': void;
  'showViewerRequest': void;
  'hideViewerRequest': void;
  'viewerWillShow': void;
  'viewerDidShow': void;
  'viewerWillHide': void;
  'viewerDidHide': void;
  'feedbackViewerImplReady': void;
  'screenshotTaken': { dataUrl: string; timestamp: number };
  'elementSelected': {
    element: Element;
    html: string;
    selector: string;
    rect: DOMRect | null;
  };
  'elementDeselected': void;
  'fixRated': AddRatingRequestBody;
  'aiJsonPatch': { payload: any; originalHtml: string }; // Added for JSON patch data
  'aiDomUpdateReceived': { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }; // Added for direct DOM updates
  'aiThinking': string;
  'aiThinkingDone': void;
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