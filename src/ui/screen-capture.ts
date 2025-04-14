import html2canvas from 'html2canvas';

/**
 * Handles capturing a selected area of the screen.
 */
class ScreenCapture {
    private overlay: HTMLDivElement | null = null;
    private selectionBox: HTMLDivElement | null = null;
    private startX: number = 0;
    private startY: number = 0;
    private isSelecting: boolean = false;
    private captureCallback: ((imageDataUrl: string | null) => void) | null = null;

    private createElements(): void {
        console.log('[ScreenCapture] Creating overlay and selection box elements...');
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.style.position = 'fixed';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.width = '100%';
        this.overlay.style.height = '100%';
        this.overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
        this.overlay.style.zIndex = '2000'; // Higher than other UI
        this.overlay.style.cursor = 'crosshair';
        document.body.appendChild(this.overlay);
        console.log('[ScreenCapture] Overlay appended to body.');

        // Create selection box
        this.selectionBox = document.createElement('div');
        this.selectionBox.style.position = 'absolute';
        this.selectionBox.style.border = '1px dashed #fff';
        this.selectionBox.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        this.selectionBox.style.display = 'none'; // Initially hidden
        this.overlay.appendChild(this.selectionBox);
        console.log('[ScreenCapture] Selection box appended to overlay.');
    }

    private cleanup(): void {
        console.log('[ScreenCapture] Cleaning up listeners and elements...');
        document.removeEventListener('mousedown', this.handleMouseDown);
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.body.style.cursor = 'default';

        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
            console.log('[ScreenCapture] Overlay removed.');
        } else {
            console.log('[ScreenCapture] Cleanup: Overlay not found or already removed.');
        }
        this.overlay = null;
        this.selectionBox = null;
        this.isSelecting = false;
        this.captureCallback = null; // Clear callback reference
        console.log('[ScreenCapture] Cleanup complete.');
    }

    private handleMouseDown = (e: MouseEvent): void => {
        console.log('[ScreenCapture] handleMouseDown triggered.');
        this.isSelecting = true;
        this.startX = e.clientX;
        this.startY = e.clientY;

        if (this.selectionBox) {
            this.selectionBox.style.left = `${this.startX}px`;
            this.selectionBox.style.top = `${this.startY}px`;
            this.selectionBox.style.width = '0px';
            this.selectionBox.style.height = '0px';
            this.selectionBox.style.display = 'block';
            console.log(`[ScreenCapture] Selection started at (${this.startX}, ${this.startY}).`);
        } else {
             console.warn('[ScreenCapture] handleMouseDown: selectionBox is null!');
        }
    };

    private handleMouseMove = (e: MouseEvent): void => {
        // Reduce log spam: only log if selecting
        if (!this.isSelecting) return;
        // console.log('[ScreenCapture] handleMouseMove triggered.'); // Optional: uncomment if needed, but can be noisy

        if (!this.selectionBox) {
             console.warn('[ScreenCapture] handleMouseMove: selectionBox is null!');
             return;
        };

        const currentX = e.clientX;
        const currentY = e.clientY;

        const width = Math.abs(currentX - this.startX);
        const height = Math.abs(currentY - this.startY);
        const left = Math.min(currentX, this.startX);
        const top = Math.min(currentY, this.startY);

        this.selectionBox.style.left = `${left}px`;
        this.selectionBox.style.top = `${top}px`;
        this.selectionBox.style.width = `${width}px`;
        this.selectionBox.style.height = `${height}px`;
    };

    private handleMouseUp = async (e: MouseEvent): Promise<void> => {
        console.log('[ScreenCapture] handleMouseUp triggered.');
        if (!this.isSelecting) {
            console.log('[ScreenCapture] handleMouseUp: Not currently selecting, ignoring.');
            // Ensure cleanup happens even if mouseup occurs without mousedown
            this.cleanup();
            return;
        }
        this.isSelecting = false; // Stop selection process immediately

        const endX = e.clientX;
        const endY = e.clientY;

        const x = Math.min(this.startX, endX);
        const y = Math.min(this.startY, endY);
        const width = Math.abs(endX - this.startX);
        const height = Math.abs(endY - this.startY);
        console.log(`[ScreenCapture] Selection ended. Area: x=${x}, y=${y}, w=${width}, h=${height}`);

        // Hide overlay temporarily to capture underlying content
        if (this.overlay) {
            console.log('[ScreenCapture] Hiding overlay for capture.');
            this.overlay.style.display = 'none';
        }
        document.body.style.cursor = 'default'; // Change cursor before capture

        let imageDataUrl: string | null = null;
        if (width > 5 && height > 5) { // Only capture if selection is reasonably sized
            console.log('[ScreenCapture] Selection size is valid, attempting html2canvas capture...');
            try {
                // Pass the calculated rectangle coordinates directly to html2canvas
                const canvas = await html2canvas(document.body, {
                    x: x + window.scrollX, // Source X relative to document top-left
                    y: y + window.scrollY, // Source Y relative to document top-left
                    width: width,          // Width of the selection
                    height: height,         // Height of the selection
                    useCORS: true,
                    logging: true // Keep logging enabled for now
                });
                console.log('[ScreenCapture] html2canvas capture successful (directly captured selection).');

                // The canvas returned by html2canvas is already the cropped size
                imageDataUrl = canvas.toDataURL('image/png');
                console.log('[ScreenCapture] Generated image data URL from directly captured canvas.');

            } catch (error) {
                console.error('[ScreenCapture] html2canvas capture failed:', error);
                // imageDataUrl remains null
            }
        } else {
             console.log('[ScreenCapture] Selection too small, capture cancelled.');
             // imageDataUrl remains null
        }

        // Store callback and result *before* cleanup, as cleanup nullifies this.captureCallback
        const callbackToExecute = this.captureCallback;
        const resultData = imageDataUrl; // Store the result (could be null)

        // Cleanup UI elements *after* capture attempt (success or failure)
        this.cleanup();

        // Trigger the stored callback *after* cleanup
        if (callbackToExecute) {
            console.log('[ScreenCapture] Executing stored capture callback...');
            try {
                callbackToExecute(resultData); // Use the stored result
            } catch (callbackError) {
                console.error('[ScreenCapture] Error executing the stored capture callback:', callbackError);
            }
        } else {
             // This case should ideally not happen if startCapture was called correctly,
             // but log it just in case.
             console.warn('[ScreenCapture] Stored capture callback was null after cleanup.');
        }
    };

    public startCapture(callback: (imageDataUrl: string | null) => void): void {
        console.log('[ScreenCapture] startCapture called.');
        if (this.isSelecting || this.overlay) {
            console.warn('[ScreenCapture] Capture already in progress. Ignoring request.');
            return; // Prevent multiple captures
        }

        this.captureCallback = callback;
        try {
            this.createElements();
            document.body.style.cursor = 'crosshair';

            console.log('[ScreenCapture] Adding event listeners...');
            // Use document directly to capture clicks anywhere
            document.addEventListener('mousedown', this.handleMouseDown, { capture: true }); // Use capture phase
            document.addEventListener('mousemove', this.handleMouseMove, { capture: true });
            document.addEventListener('mouseup', this.handleMouseUp, { capture: true, once: true }); // Use capture phase and once: true
            console.log('[ScreenCapture] Event listeners added.');

        } catch (error) {
            console.error('[ScreenCapture] Error during startCapture setup:', error);
            this.cleanup(); // Attempt cleanup if setup fails
            // Optionally, call the callback with null immediately on setup error
            if (this.captureCallback) {
                this.captureCallback(null);
            }
        }
    }
}

export const screenCapture = new ScreenCapture();