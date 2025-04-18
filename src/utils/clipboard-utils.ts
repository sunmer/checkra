import html2canvas from 'html2canvas';

/**
 * Copies the current viewport content as an image to the clipboard.
 * Uses html2canvas to render the body element.
 */
export async function copyViewportToClipboard(): Promise<void> {
  try {
    console.log('[ClipboardUtils] Starting viewport capture...');
    const canvas = await html2canvas(document.body, {
      logging: true,
      useCORS: true,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight
    });
    console.log('[ClipboardUtils] Canvas generated.');

    canvas.toBlob(async (blob) => {
      if (!blob) {
        console.error('[ClipboardUtils] Failed to create blob from canvas.');
        alert('Error: Could not generate image blob.');
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        console.log('[ClipboardUtils] Viewport image copied to clipboard successfully.');
        // Optional: Show a brief success message to the user
        // showTemporaryMessage('Viewport copied!');
      } catch (err) {
        console.error('[ClipboardUtils] Failed to copy blob to clipboard:', err);
        alert(`Error copying to clipboard: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 'image/png');

  } catch (error) {
    console.error('[ClipboardUtils] Error capturing viewport with html2canvas:', error);
    alert(`Error capturing screen: ${error instanceof Error ? error.message : String(error)}`);
  }
}