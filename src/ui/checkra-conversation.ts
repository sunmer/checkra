import type { ConversationItem } from '../types';

export class ConversationController {
  private history: ConversationItem[] = [];
  private static readonly STORAGE_KEY = 'checkra_conversation_history';

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(ConversationController.STORAGE_KEY);
      if (raw) {
        this.history = JSON.parse(raw) as ConversationItem[];
      }
    } catch (err) {
      // corrupted – start fresh
      this.history = [];
      localStorage.removeItem(ConversationController.STORAGE_KEY);
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(ConversationController.STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      /* ignore quota */
    }
  }

  append(item: ConversationItem) {
    this.history.push(item);
    this.saveToStorage();
  }

  /** Convenience helpers for streaming AI responses */
  startStreamingAi(): ConversationItem {
    const item: ConversationItem = { type: 'ai', content: '', isStreaming: true };
    this.append(item);
    return item;
  }

  appendToStreaming(chunk: string): ConversationItem | null {
    const current = this.history[this.history.length - 1];
    if (current && current.type === 'ai' && current.isStreaming) {
      current.content += chunk;
      return current;
    }
    return null;
  }

  finalizeStreaming(): ConversationItem | null {
    const current = this.history[this.history.length - 1];
    if (current && current.type === 'ai' && current.isStreaming) {
      current.isStreaming = false;
      this.saveToStorage();
      return current;
    }
    return null;
  }

  addUserMessage(content: string) {
    this.append({ type: 'user', content });
  }

  addErrorMessage(content: string) {
    this.append({ type: 'error', content });
  }

  get items() {
    return this.history;
  }

  clear() {
    this.history = [];
    this.saveToStorage();
  }
} 