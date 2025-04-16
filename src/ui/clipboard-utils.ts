import html2canvas from 'html2canvas';

/**
 * Copies the current viewport content as an image to the clipboard.
 * Uses html2canvas to render the body element.
 */
export async function copyViewportToClipboard(): Promise<void> {
  try {
    // Ensure the body is scrolled to the top-left before capture?
    // This might provide more consistent results for some layouts,
    // but could also be undesirable if the user wants the current view.
    // window.scrollTo(0, 0);
    // await new Promise(resolve => setTimeout(resolve, 50)); // Small delay for scroll settling

    console.log('[ClipboardUtils] Starting viewport capture...');
    const canvas = await html2canvas(document.body, {
      logging: true, // Keep logging enabled for debugging
      useCORS: true,
      // Capture the visible part of the window OR the entire scrollable content.
      // Using scrollWidth/scrollHeight captures everything, which can be large & slow.
      // Using innerWidth/innerHeight captures only the current visible viewport.
      // Let's stick with scrollWidth/Height for now, but be aware of the trade-off.
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      x: window.scrollX, // Start capture from the current scroll position X
      y: window.scrollY, // Start capture from the current scroll position Y
      // Consider adding a scale factor for higher resolution, but it increases processing time.
      // scale: window.devicePixelRatio > 1 ? window.devicePixelRatio : 1,
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
        alert('Copied to clipboard!');
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
