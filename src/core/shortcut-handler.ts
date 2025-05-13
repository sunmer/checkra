import { eventEmitter } from './index';

document.addEventListener('keydown', (event: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcutPressed = 
        (isMac ? event.metaKey : event.ctrlKey) && 
        !event.altKey &&
        !event.shiftKey &&
        event.key === 'l';

    if (shortcutPressed) {
        event.preventDefault();
        eventEmitter.emit('toggleViewerShortcut');
    }
}); 