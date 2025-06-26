/**
 * VariantPicker – lightweight popover listing sibling component variants.
 * Works similarly to RatingUI but simpler: just a list of pill buttons.
 */
export class VariantPicker {
  private container: HTMLDivElement | null = null;
  private clickOutsideListener: ((e: MouseEvent) => void) | null = null;

  /**
   * Show the popover next to anchorElement.
   * @param anchorElement element to anchor (typically the variant button)
   * @param variants array of catalogue entries (objects with id & displayName properties expected)
   * @param onSelect callback when a variant id is chosen
   * @param onClose called when popover dismissed w/o selection
   */
  public showVariantPopover(
    anchorElement: HTMLElement,
    variants: any[],
    onSelect: (variantId: string) => void,
    onClose: () => void
  ): void {
    // If already open, first close existing one
    if (this.container) this.hidePopover();

    this.container = document.createElement('div');
    this.container.className = 'checkra-feedback-variant-options';
    // Basic inline style (mirrors rating popover)
    Object.assign(this.container.style, {
      position: 'absolute',
      zIndex: '10001',
      backgroundColor: 'rgba(40,40,40,0.95)',
      border: '1px solid rgba(80,80,80,0.9)',
      borderRadius: '16px',
      padding: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      minWidth: '160px',
      boxShadow: '0 3px 8px rgba(0,0,0,0.4)'
    } as CSSStyleDeclaration);

    if (variants.length === 0) {
      const noOpt = document.createElement('div');
      noOpt.textContent = 'No other variants';
      noOpt.style.opacity = '0.6';
      noOpt.style.cursor = 'default';
      this.container.appendChild(noOpt);
    } else {
      variants.forEach((entry) => {
        const btn = document.createElement('div');
        btn.className = 'checkra-feedback-rating-option'; // Re-use pill style from rating
        btn.textContent = entry.title || entry.displayName || entry.id;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hidePopover();
          onSelect(entry.id);
        });
        this.container!.appendChild(btn);
      });
    }

    document.body.appendChild(this.container);
    this.positionPopover(anchorElement);

    // Click outside to close
    setTimeout(() => {
      this.clickOutsideListener = (ev: MouseEvent) => {
        if (this.container && !this.container.contains(ev.target as Node) && ev.target !== anchorElement) {
          this.hidePopover();
          onClose();
        }
      };
      document.addEventListener('click', this.clickOutsideListener, true);
    }, 0);
  }

  private positionPopover(anchorElement: HTMLElement): void {
    if (!this.container) return;
    const rect = anchorElement.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 5;
    let left = rect.left + window.scrollX;

    this.container.style.top = `${top}px`;
    this.container.style.left = `${left}px`;

    // Adjust if off-screen
    const popRect = this.container.getBoundingClientRect();
    if (popRect.right > window.innerWidth) {
      left = window.innerWidth - popRect.width - 10;
    }
    if (popRect.bottom > window.innerHeight) {
      top = rect.top + window.scrollY - popRect.height - 5;
    }
    this.container.style.top = `${top}px`;
    this.container.style.left = `${Math.max(10, left)}px`;
  }

  public hidePopover(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    if (this.clickOutsideListener) {
      document.removeEventListener('click', this.clickOutsideListener, true);
      this.clickOutsideListener = null;
    }
  }
} 