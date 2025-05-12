import { eventEmitter } from '../core/index';

document.addEventListener('keydown', (e: KeyboardEvent) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutPressed = (isMac && e.metaKey && e.key.toLowerCase() === 'l') || 
                          (!isMac && e.ctrlKey && e.key.toLowerCase() === 'l');

  if (shortcutPressed) {
    e.preventDefault();
    eventEmitter.emit('toggleViewerShortcut');
    console.log('[ShortcutHandler] Emitted toggleViewerShortcut event.');
  }
});

console.log('[ShortcutHandler] Global shortcut listener (Cmd/Ctrl + L) registered.'); 