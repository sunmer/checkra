import { customError } from '../utils/logger';
import type { CheckraDOM } from './checkra-dom';

export interface ConversationItem {
  type: 'user' | 'ai' | 'usermessage' | 'error';
  content: string;
  isStreaming?: boolean; // Optional flag for AI messages
  fix?: { // Optional fix data for AI messages
    originalHtml: string;
    fixedHtml: string;
    fixId: string;
  };
}

const CONVERSATION_HISTORY_KEY = 'checkra_conversation_history';

export class ConversationHistory {
  private history: ConversationItem[] = [];
  private domManager: CheckraDOM | null = null;

  constructor(domManager?: CheckraDOM) {
    if (domManager) {
      this.domManager = domManager;
    }
    this.loadHistory();
  }

  public setDomManager(domManager: CheckraDOM): void {
    this.domManager = domManager;
    if (this.domManager && this.history.length > 0) {
      this.domManager.renderFullHistory(this.history);
    }
  }

  public getHistory(): ConversationItem[] {
    return [...this.history];
  }

  public clearHistory(): void {
    this.history = [];
    try {
      localStorage.removeItem(CONVERSATION_HISTORY_KEY);
    } catch (e) {
      customError('[ConversationHistory] Failed to remove conversation history from localStorage:', e);
    }
  }

  public loadHistory(): void {
    try {
      const storedHistory = localStorage.getItem(CONVERSATION_HISTORY_KEY);
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory) as ConversationItem[];
        this.history = parsedHistory.map(item => {
          if (item.type === 'ai') {
            return { ...item, isStreaming: false };
          }
          return item;
        });
      } else {
        this.history = [];
      }
    } catch (e) {
      customError('[ConversationHistory] Failed to load or parse conversation history:', e);
      this.history = [];
      localStorage.removeItem(CONVERSATION_HISTORY_KEY); // Clear corrupted data
    }
  }

  public saveHistory(newItem?: ConversationItem): void {
    if (newItem) {
      if (newItem.type === 'ai' && !('isStreaming' in newItem)) {
        newItem.isStreaming = true; 
      }
      this.history.push(newItem);
    }
    try {
      localStorage.setItem(CONVERSATION_HISTORY_KEY, JSON.stringify(this.history));
    } catch (e) {
      customError('[ConversationHistory] Failed to save conversation history:', e);
    }

    if (this.domManager && newItem) {
      this.domManager.appendHistoryItem(newItem);
    }
  }

  public updateLastAIMessage(content: string, isStreaming: boolean): void {
    const lastItem = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    if (lastItem && lastItem.type === 'ai') {
      lastItem.content = content;
      lastItem.isStreaming = isStreaming;
      if (this.domManager) {
        this.domManager.updateLastAIMessage(content, isStreaming);
      }
      // Save history after updating the last AI message, but without adding a new item
      this.saveHistory(); 
    }    
  }

  public finalizeLastAIItem(fixData?: { originalHtml: string; fixedHtml: string; fixId: string }): void {
    const lastItem = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    if (lastItem && lastItem.type === 'ai' && lastItem.isStreaming) {
      lastItem.isStreaming = false;
      if (fixData) {
        lastItem.fix = fixData;
      }
      if (this.domManager) {
        this.domManager.updateLastAIMessage(lastItem.content, false);
      }
       // Save history after finalizing the last AI item
      this.saveHistory(); 
    }
  }

  public getActiveStreamingAIItem(): ConversationItem | null {
    if (this.history.length > 0) {
        const lastItem = this.history[this.history.length -1];
        if (lastItem.type === 'ai' && lastItem.isStreaming) {
            return lastItem;
        }
    }
    return null;
  }

   public setLastAIItemContent(content: string): void {
    const lastItem = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    if (lastItem && lastItem.type === 'ai') {
      lastItem.content = content;
       // No DOM update here, this is usually called by extractAndStoreFixHtml which modifies content
       // before the final DOM update. Save is important though.
      this.saveHistory(); 
    }
  }
} 