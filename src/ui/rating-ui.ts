import type { AppliedFixInfo } from './applied-fix-store';
import type { AddRatingRequestBody } from '../types';


export class RatingUI {
  private ratingOptionsContainer: HTMLDivElement | null = null;
  private clickOutsideListener: ((event: MouseEvent) => void) | null = null;

  public showRatingPopover(
    fixInfo: AppliedFixInfo,
    anchorElement: HTMLElement, // This is the rate button itself
    fixId: string,
    // requestBody is already in fixInfo, fixedOuterHTML also in fixInfo
    // resolvedColors also in fixInfo
    onRateCallback: (payload: AddRatingRequestBody) => void,
    onPopoverClose: () => void // Callback when popover is closed without rating
  ): void {
    // If a popover is already open for this instance, close it first or do nothing
    if (this.ratingOptionsContainer) {
      this.hideRatingPopover();
      // Potentially call onPopoverClose if it wasn't the same button click toggling it
      // For simplicity, just ensure it's closed.
      // If the same button triggered this, it's a toggle, otherwise it's a new request.
      // The current logic in checkra-impl already checks and removes existing one,
      // so this might be redundant if called from there. Let's assume a clean slate.
    }

    this.ratingOptionsContainer = document.createElement('div');
    this.ratingOptionsContainer.className = 'feedback-fix-rating-options';
    // Unique attribute to find *this specific* popover if multiple RatingUI instances were ever used (not current design)
    // Or, more simply, to ensure we're only managing one popover at a time per RatingUI instance.
    // this.ratingOptionsContainer.setAttribute('data-rating-ui-instance-for-fix', fixId);

    const ratings = [
      { value: 1, text: '★ Not OK' },
      { value: 2, text: '★★ OK' },
      { value: 3, text: '★★★ Pretty good' },
      { value: 4, text: '★★★★ Wow!' },
    ];

    ratings.forEach(rating => {
      const optionElement = document.createElement('div');
      optionElement.className = 'feedback-rating-option';
      optionElement.textContent = rating.text;
      optionElement.setAttribute('data-rating-value', rating.value.toString());

      optionElement.addEventListener('click', (e) => {
        const existingForm = optionElement.querySelector('.feedback-rating-feedback-form');
        if (existingForm && existingForm.contains(e.target as Node)) {
          return;
        }
        e.stopPropagation();

        if (rating.value === 1 || rating.value === 2) {
          const alreadyExistingForm = this.ratingOptionsContainer?.querySelector('.feedback-rating-feedback-form');
          if (alreadyExistingForm) alreadyExistingForm.remove();

          const feedbackForm = this.createFeedbackForm(
            fixId,
            rating.value as 1 | 2,
            fixInfo,
            onRateCallback,
            () => this.hideRatingPopover() // Close popover after submission
          );
          optionElement.appendChild(feedbackForm);
          const feedbackInput = feedbackForm.querySelector('.feedback-rating-feedback-input') as HTMLInputElement;
          if (feedbackInput) {
            feedbackInput.focus();
          }
        } else {
          // For ratings 3 or 4, submit immediately
          const feedbackPayload: AddRatingRequestBody = {
            ...fixInfo.requestBody, // Spread the original request body
            rating: rating.value as 3 | 4,
            fixId: fixId,
            generatedHtml: fixInfo.fixedOuterHTML,
            resolvedPrimaryColorInfo: fixInfo.resolvedColors?.resolvedPrimaryColorInfo,
            resolvedAccentColorInfo: fixInfo.resolvedColors?.resolvedAccentColorInfo,
          };
          onRateCallback(feedbackPayload);
          this.hideRatingPopover();
        }
      });
      this.ratingOptionsContainer!.appendChild(optionElement);
    });

    document.body.appendChild(this.ratingOptionsContainer);
    this.positionPopover(anchorElement);

    // Add click outside listener
    // Use a timeout to ensure the current click event that opened the popover doesn't immediately close it
    setTimeout(() => {
      this.clickOutsideListener = (event: MouseEvent) => {
        if (this.ratingOptionsContainer &&
            !this.ratingOptionsContainer.contains(event.target as Node) &&
            event.target !== anchorElement) {
          this.hideRatingPopover();
          onPopoverClose(); // Notify that it was closed without a rating action
        }
      };
      document.addEventListener('click', this.clickOutsideListener, true);
    }, 0);
  }

  private createFeedbackForm(
    fixId: string,
    ratingValue: 1 | 2,
    fixInfo: AppliedFixInfo,
    onRateCallback: (payload: AddRatingRequestBody) => void,
    onFormSubmitOrCancel: () => void
  ): HTMLFormElement {
    const feedbackForm = document.createElement('form');
    feedbackForm.className = 'feedback-rating-feedback-form';
    // Basic styling, can be moved to CSS
    Object.assign(feedbackForm.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginTop: '8px',
        padding: '10px',
        backgroundColor: '#333', // Darker background for the form itself
        borderRadius: '6px'
    } as CSSStyleDeclaration);


    feedbackForm.addEventListener('click', (ev) => ev.stopPropagation()); // Prevent closing popover

    const feedbackInput = document.createElement('input');
    feedbackInput.type = 'text';
    feedbackInput.placeholder = 'Optional: What could be improved?';
    feedbackInput.className = 'feedback-rating-feedback-input';

    const chipLabels = ['ugly', 'off brand', 'broken', 'copy', 'colors', 'layout', 'spacing', 'text', 'other'];
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'feedback-rating-chips-container';


    let selectedChips: Set<string> = new Set();

    chipLabels.forEach(label => {
      const chip = document.createElement('button');
      chip.type = 'button'; // Important for forms
      chip.textContent = label;
      chip.className = 'feedback-rating-chip'; // Add styling for this class
      chip.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (selectedChips.has(label)) {
          selectedChips.delete(label);
          chip.classList.remove('active');
        } else {
          selectedChips.add(label);
          chip.classList.add('active');
        }
        updateSubmitState();
      });
      chipsContainer.appendChild(chip);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button'; // To prevent form submission via enter if not intended
    submitBtn.textContent = 'Submit Rating';
    submitBtn.className = 'feedback-rating-feedback-submit';
    submitBtn.disabled = true; // Initially disabled

    function updateSubmitState() {
      const feedbackVal = feedbackInput.value.trim();
      if (feedbackVal.length > 0 || selectedChips.size > 0) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
      } else {
        // Allow submitting a 1 or 2 star rating without feedback text or chips
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        // submitBtn.disabled = true; // Previous logic
        // submitBtn.style.opacity = '0.7'; // Previous logic
      }
    }
    updateSubmitState(); // Call once to set initial state correctly for 1/2 star w/o feedback

    feedbackInput.addEventListener('input', updateSubmitState);

    submitBtn.addEventListener('click', () => {
      const feedbackVal = feedbackInput.value.trim();
      const feedbackPayload: AddRatingRequestBody = {
        ...fixInfo.requestBody,
        rating: ratingValue,
        feedback: feedbackVal || undefined,
        fixId: fixId,
        tags: selectedChips.size > 0 ? Array.from(selectedChips) : undefined,
        generatedHtml: fixInfo.fixedOuterHTML,
        resolvedPrimaryColorInfo: fixInfo.resolvedColors?.resolvedPrimaryColorInfo,
        resolvedAccentColorInfo: fixInfo.resolvedColors?.resolvedAccentColorInfo,
      };
      onRateCallback(feedbackPayload);
      onFormSubmitOrCancel(); // This will hide the popover
    });

    feedbackInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (!submitBtn.disabled) {
            submitBtn.click();
        }
      }
    });

    feedbackForm.appendChild(feedbackInput);
    feedbackForm.appendChild(chipsContainer);
    feedbackForm.appendChild(submitBtn);

    return feedbackForm;
  }

  private positionPopover(anchorElement: HTMLElement): void {
    if (!this.ratingOptionsContainer) return;

    const anchorRect = anchorElement.getBoundingClientRect();
    // Position below the anchor by default
    let top = anchorRect.bottom + window.scrollY + 5; // 5px gap
    let left = anchorRect.left + window.scrollX;

    this.ratingOptionsContainer.style.position = 'absolute';
    this.ratingOptionsContainer.style.top = `${top}px`;
    this.ratingOptionsContainer.style.left = `${left}px`;
    this.ratingOptionsContainer.style.zIndex = '10001'; // Ensure it's above most things

    // Basic styling for the popover - can be expanded in CSS
    Object.assign(this.ratingOptionsContainer.style, {
        backgroundColor: '#2a2a2a', // Slightly lighter than form
        border: '1px solid #444',
        borderRadius: '8px',
        padding: '10px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        minWidth: '180px'
    } as CSSStyleDeclaration);


    // Adjust if it goes off-screen
    const popoverRect = this.ratingOptionsContainer.getBoundingClientRect();
    if (popoverRect.right > window.innerWidth) {
      left = window.innerWidth - popoverRect.width - 10; // 10px padding from edge
    }
    if (popoverRect.bottom > window.innerHeight) {
      top = anchorRect.top + window.scrollY - popoverRect.height - 5; // Position above
    }
    this.ratingOptionsContainer.style.top = `${top}px`;
    this.ratingOptionsContainer.style.left = `${Math.max(10, left)}px`; // Ensure at least 10px from left edge
  }

  public hideRatingPopover(): void {
    if (this.ratingOptionsContainer) {
      this.ratingOptionsContainer.remove();
      this.ratingOptionsContainer = null;
    }
    if (this.clickOutsideListener) {
      document.removeEventListener('click', this.clickOutsideListener, true);
      this.clickOutsideListener = null;
    }
  }

  // Helper to apply styles directly for elements created in this class
  // This is an alternative to relying solely on global CSS if these elements
  // are only created and managed here.
  public applyStyles(): void {
    const styleId = 'checkra-rating-ui-styles';
    if (document.getElementById(styleId)) return;

    const styleSheet = document.createElement('style');
    styleSheet.id = styleId;
    styleSheet.textContent = `
      .feedback-fix-rating-options {
        /* Styles for the main popover container are mostly applied inline via JS */
        /* but some defaults can go here */
      }
      .feedback-rating-option {
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
        color: #e0e0e0;
        font-size: 13px;
      }
      .feedback-rating-option:hover {
        background-color: #383838;
      }
      .feedback-rating-feedback-form {
        /* Styles applied inline */
      }
      .feedback-rating-feedback-input {
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid #555;
        font-size: 13px;
        background-color: #1e1e1e;
        color: #e0e0e0;
        margin-bottom: 8px;
      }
      .feedback-rating-feedback-input::placeholder {
        color: #888;
      }
      .feedback-rating-chips-container {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 10px;
      }
      .feedback-rating-chip {
        padding: 5px 10px;
        font-size: 11px;
        border-radius: 12px;
        border: 1px solid #666;
        background-color: #4a4a4a;
        color: #ddd;
        cursor: pointer;
        transition: background-color 0.2s, color 0.2s;
      }
      .feedback-rating-chip.active {
        background-color: #2563eb; /* Tailwind blue-600 */
        color: #fff;
        border-color: #2563eb;
      }
      .feedback-rating-chip:hover:not(.active) {
        background-color: #5a5a5a;
      }
      .feedback-rating-feedback-submit {
        padding: 8px 12px;
        border-radius: 6px;
        background-color: #2563eb; /* Tailwind blue-600 */
        color: #fff;
        font-weight: 500;
        font-size: 13px;
        border: none;
        cursor: pointer;
        transition: opacity 0.2s;
      }
      .feedback-rating-feedback-submit:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(styleSheet);
  }
}
