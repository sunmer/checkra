import { eventEmitter } from '../core/index';
// import type { CheckraImplementation } from './checkra-impl';
import type { GenerateSuggestionRequestbody, ResolvedColorInfo } from '../types';

// Define an interface for the callback methods from CheckraImplementation needed by ViewerEvents
export interface ViewerEventCallbacks {
  boundUpdateResponse: (chunk: string) => void;
  boundRenderUserMessage: (message: string) => void;
  boundShowError: (error: Error | string) => void;
  boundFinalizeResponse: () => void;
  boundToggle: () => void;
  boundShowFromApi: (triggeredByUserAction?: boolean) => void;
  boundHandleSuggestionClick: (promptText: string) => void;
  boundHandleJsonPatch: (patchEvent: { payload: any; originalHtml: string }) => void;
  boundHandleDomUpdate: (data: { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }) => void;
  boundHandleRequestBodyPrepared: (requestBody: GenerateSuggestionRequestbody) => void;
  boundHandleResolvedColorsUpdate: (colors: ResolvedColorInfo) => void;
  // Add any other bound methods from CheckraImplementation that are used as event handlers
}

export class ViewerEvents {
  private ui: ViewerEventCallbacks;

  constructor(uiCallbacks: ViewerEventCallbacks) {
    this.ui = uiCallbacks;
  }

  public subscribe(): void {
    eventEmitter.on('aiResponseChunk', this.ui.boundUpdateResponse);
    eventEmitter.on('aiUserMessage', this.ui.boundRenderUserMessage);
    eventEmitter.on('aiError', this.ui.boundShowError);
    eventEmitter.on('aiFinalized', this.ui.boundFinalizeResponse);
    eventEmitter.on('toggleViewerShortcut', this.ui.boundToggle);
    eventEmitter.on('showViewerApi', this.ui.boundShowFromApi);
    eventEmitter.on('onboardingSuggestionClicked', this.ui.boundHandleSuggestionClick);
    eventEmitter.on('aiJsonPatch', this.ui.boundHandleJsonPatch);
    eventEmitter.on('aiDomUpdateReceived', this.ui.boundHandleDomUpdate);
    eventEmitter.on('requestBodyPrepared', this.ui.boundHandleRequestBodyPrepared);
    eventEmitter.on('internalResolvedColorsUpdate', this.ui.boundHandleResolvedColorsUpdate);
    // Add other event subscriptions here if any were missed from the interface
  }

  public unsubscribe(): void {
    eventEmitter.off('aiResponseChunk', this.ui.boundUpdateResponse);
    eventEmitter.off('aiUserMessage', this.ui.boundRenderUserMessage);
    eventEmitter.off('aiError', this.ui.boundShowError);
    eventEmitter.off('aiFinalized', this.ui.boundFinalizeResponse);
    eventEmitter.off('toggleViewerShortcut', this.ui.boundToggle);
    eventEmitter.off('showViewerApi', this.ui.boundShowFromApi);
    eventEmitter.off('onboardingSuggestionClicked', this.ui.boundHandleSuggestionClick);
    eventEmitter.off('aiJsonPatch', this.ui.boundHandleJsonPatch);
    eventEmitter.off('aiDomUpdateReceived', this.ui.boundHandleDomUpdate);
    eventEmitter.off('requestBodyPrepared', this.ui.boundHandleRequestBodyPrepared);
    eventEmitter.off('internalResolvedColorsUpdate', this.ui.boundHandleResolvedColorsUpdate);
    // Add other event unsubscriptions here
  }
} 