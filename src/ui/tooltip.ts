import { debounce } from './utils';

/**
 * Class for managing tooltip functionality.
 */
export class Tooltip {
  private tooltip: HTMLDivElement | null = null;
  private activeElement: HTMLElement | null = null;

  /**
   * Creates the tooltip DOM element.
   */
  public create(): void {
    if (this.tooltip) return;

    this.tooltip = document.createElement('div');
    this.tooltip.style.position = 'absolute';
    this.tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    this.tooltip.style.color = 'white';
    this.tooltip.style.padding = '5px 8px';
    this.tooltip.style.borderRadius = '4px';
    this.tooltip.style.fontSize = '12px';
    this.tooltip.style.maxWidth = '400px';
    this.tooltip.style.wordWrap = 'break-word';
    this.tooltip.style.zIndex = '1001';
    this.tooltip.style.pointerEvents = 'none';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);
  }

  /**
   * Shows the tooltip with specified content.
   */
  public show(content: string, relatedElement: HTMLElement): void {
    if (!this.tooltip) this.create();
    
    this.tooltip!.textContent = content;
    this.tooltip!.style.display = 'block';
    this.activeElement = relatedElement;
    
    document.addEventListener('mousemove', this.updatePositionHandler);
  }

  /**
   * Hides the tooltip.
   */
  public hide(): void {
    if (!this.tooltip) return;
    
    this.tooltip.style.display = 'none';
    document.removeEventListener('mousemove', this.updatePositionHandler);
    this.activeElement = null;
  }

  /**
   * Updates the tooltip position based on mouse event.
   */
  private updatePosition = (e: MouseEvent): void => {
    if (!this.tooltip || !this.activeElement) return;

    const offset = 10; // Distance from cursor

    // Get tooltip dimensions
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width;
    const tooltipHeight = tooltipRect.height;

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate potential position
    let left = e.pageX + offset;
    let top = e.pageY + offset;

    // Adjust if would go off-screen
    if (left + tooltipWidth > viewportWidth - 10) {
      left = e.pageX - tooltipWidth - offset; // Place left of cursor instead
    }

    if (top + tooltipHeight > viewportHeight - 10) {
      top = e.pageY - tooltipHeight - offset; // Place above cursor instead
    }

    // Ensure tooltip is never positioned off-screen
    left = Math.max(10, left);
    top = Math.max(10, top);

    this.tooltip.style.left = left + 'px';
    this.tooltip.style.top = top + 'px';
  };

  // Debounced version of updatePosition for performance
  private updatePositionHandler = debounce(this.updatePosition, 10);

  /**
   * Destroys the tooltip component, removing DOM elements and event listeners.
   */
  public destroy(): void {
    // Remove event listeners
    document.removeEventListener('mousemove', this.updatePositionHandler);
    
    // Remove the tooltip element from the DOM
    if (this.tooltip && this.tooltip.parentNode) {
      this.tooltip.parentNode.removeChild(this.tooltip);
    }
    
    // Clear references
    this.tooltip = null;
    this.activeElement = null;
  }
}

// Singleton instance
export const tooltip = new Tooltip();