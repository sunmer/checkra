import { eventEmitter } from './index';

let lastShiftPressTime = 0;
const DOUBLE_PRESS_THRESHOLD = 300; // Milliseconds, adjust as needed

document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Shift') {
        const currentTime = Date.now();
        if (currentTime - lastShiftPressTime < DOUBLE_PRESS_THRESHOLD) {
            // Double press detected
            event.preventDefault();
            eventEmitter.emit('toggleViewerShortcut');
            lastShiftPressTime = 0; // Reset to prevent immediate re-trigger on a third press
        } else {
            // First press or too slow for a double press
            lastShiftPressTime = currentTime;
        }
    } else {
        // If any other key is pressed, reset the sequence
        lastShiftPressTime = 0;
    }
}); 