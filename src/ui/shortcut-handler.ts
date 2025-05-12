import { feedbackViewer } from './feedback-viewer';

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Check for Cmd+L on Mac or Ctrl+L on Windows/Linux
  if ((e.metaKey && e.key === 'l') || (e.ctrlKey && e.key === 'l')) {
    // Prevent default browser action (like focusing address bar on Ctrl+L)
    // Note: This might not always work reliably across all browsers/OS configurations for Ctrl+L
    e.preventDefault();
    feedbackViewer.toggle(); // We will implement this toggle method next
    console.log('[Shortcut] Toggle shortcut triggered.');
  }
});

// Log registration
console.log('[Shortcut] Global shortcut listener registered (Cmd/Ctrl + L).'); 