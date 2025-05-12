import FeedbackViewer from './feedback-viewer';

document.addEventListener('keydown', (e: KeyboardEvent) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutPressed = (isMac && e.metaKey && e.key.toLowerCase() === 'l') || 
                          (!isMac && e.ctrlKey && e.key.toLowerCase() === 'l');

  if (shortcutPressed) {
    e.preventDefault();
    try {
      // HACK: Relies on FeedbackViewer.instance already being initialized by core/index.ts
      // with a valid SettingsModal. Passing null here is unsafe if core hasn't run.
      const viewerInstance = FeedbackViewer.getInstance(null as any);
      if (viewerInstance) {
        viewerInstance.toggle();
        console.log('[ShortcutHandler] Toggle triggered via FeedbackViewer instance.');
      } else {
        console.error('[ShortcutHandler] FeedbackViewer instance not available. core/index.ts might not have initialized it.');
      }
    } catch (error) {
      console.error('[ShortcutHandler] Error toggling viewer:', error);
    }
  }
});

console.log('[ShortcutHandler] Global shortcut listener (Cmd/Ctrl + L) registered.'); 