export class CheckraView {
  constructor(private domManager: any) {}

  initialize() {
    // TODO: move create(), listener setup, onboarding UI etc. from checkra-impl.ts here
  }

  show() {
    this.domManager?.show();
  }

  hide() {
    this.domManager?.hide();
  }

  /**
   * Pass-through helpers so code that already calls domManager keeps working
   * while we incrementally migrate the implementation details.
   */
  updateLoaderVisibility(isVisible: boolean, label?: string) {
    this.domManager?.updateLoaderVisibility(isVisible, label);
  }

  setPromptState(enabled: boolean, value?: string) {
    this.domManager?.setPromptState(enabled, value);
  }

  updateSubmitButtonState(enabled: boolean) {
    this.domManager?.updateSubmitButtonState(enabled);
  }

  appendHistoryItem(item: any) {
    this.domManager?.appendHistoryItem(item);
  }

  updateLastAIMessage(content: string, streaming: boolean) {
    this.domManager?.updateLastAIMessage(content, streaming);
  }

  renderFullHistory(history: any[]) {
    this.domManager?.renderFullHistory(history);
  }

  clearAIResponseContent() {
    this.domManager?.clearAIResponseContent();
  }

  showOnboardingView(show: boolean) {
    this.domManager?.showOnboardingView(show);
  }

  showPromptInputArea(show: boolean, preset?: string) {
    this.domManager?.showPromptInputArea(show, preset);
  }

  showAvailabilityToast() {
    this.domManager?.showAvailabilityToast();
  }

  // Add more pass-throughs as soon as the orchestrator needs them.
} 