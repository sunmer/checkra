import './settings-modal.css';
import { eventEmitter } from '../core/index';
import { AiSettings } from '../types';

/**
 * Class for managing the settings modal UI component.
 */
export class SettingsModal {
  private modalContainer: HTMLDivElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;

  private currentSettings: AiSettings = {
    model: 'gpt-4.1',
    temperature: 0.7,
  };

  // Store bound event handlers
  private boundHideModalHandler: (() => void) | null = null;
  private boundModelChangeHandler: ((event: Event) => void) | null = null;

  /**
   * Creates a new SettingsModal instance.
   */
  constructor() {}

  /**
   * Removes the modal DOM elements and listeners, but preserves internal state.
   */
  private destroyDOM(): void {
    this.removeListeners();

    // Attempt to remove the element by ID for robustness
    const modalElement = document.getElementById('checkra-settings-modal-container');
    if (modalElement?.parentNode) {
      modalElement.parentNode.removeChild(modalElement);
    }

    // Clear only DOM references, keep currentSettings
    this.modalContainer = null;
    this.closeButton = null;
    this.modelSelect = null;
  }

  /**
   * Creates the settings modal DOM elements.
   * Assumes any previous modal has been destroyed.
   */
  private create(): void {
    // --- Check document.body readiness --- //
    if (!document.body) {
      console.error('[SettingsModal] Cannot create modal: document.body is not available yet.');
      return; // Exit if body not ready
    }
    
    // --- Create Modal Container ---
    this.modalContainer = document.createElement('div');
    this.modalContainer.id = 'checkra-settings-modal-container';

    const header = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = 'Settings';

    this.closeButton = document.createElement('button');
    this.closeButton.id = 'checkra-settings-modal-close'; // ADD ID for CSS targeting
    this.closeButton.innerHTML = '&times;';
    this.closeButton.title = 'Close Settings';

    header.appendChild(title);
    header.appendChild(this.closeButton);

    // --- Create Content Area ---
    const content = document.createElement('div');

    // --- Model Select ---
    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'AI model:';
    modelLabel.htmlFor = 'checkra-ai-model-select';

    this.modelSelect = document.createElement('select');
    this.modelSelect.id = 'checkra-ai-model-select';

    content.appendChild(modelLabel);
    content.appendChild(this.modelSelect);

    // --- Append major sections to modal container ---
    this.modalContainer.appendChild(header);
    this.modalContainer.appendChild(content);

    this._populateSelectOptions();
    document.body.appendChild(this.modalContainer);
    this.attachListeners();
  }

  /**
   * Populates the model and temperature select dropdowns with options.
   */
  private _populateSelectOptions(): void {

    if (this.modelSelect) {
      this.modelSelect.innerHTML = '';
      const modelOptions = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'];
      modelOptions.forEach(optionText => {
        const option = document.createElement('option');
        option.value = optionText.toLowerCase().replace(/ /g, '-');
        option.textContent = optionText;
        if (option.value === this.currentSettings.model) {
          option.selected = true;
        }
        this.modelSelect?.appendChild(option);
      });
    } else {
       console.error('[SettingsModal] Cannot populate models: this.modelSelect is null.');
    }
  }

  /**
   * Attaches event listeners to the DOM elements.
   */
  private attachListeners(): void {
    if (!this.closeButton || !this.modelSelect) {
      console.error(`[SettingsModal] Cannot attach listeners: elements not found.`);
      return;
    }

    this.removeListeners();

    this.boundHideModalHandler = this.hideModal.bind(this);
    this.boundModelChangeHandler = (event: Event) => {
      const selectedModel = (event.target as HTMLSelectElement).value;
      this.currentSettings.model = selectedModel;
      eventEmitter.emit('settingsChanged', { ...this.currentSettings });
    };
    const boundOverlayClickHandler = (event: MouseEvent) => {
      if (this.modalContainer && event.target === this.modalContainer) {
        event.stopPropagation(); // Prevent click from reaching document listener
        this.hideModal();
      }
    };

    this.closeButton.addEventListener('click', this.boundHideModalHandler);
    this.modelSelect.addEventListener('change', this.boundModelChangeHandler);
    this.modalContainer?.addEventListener('click', boundOverlayClickHandler);
  }

  /**
   * Removes event listeners from the DOM elements.
   */
  private removeListeners(): void {
    // NOTE: Need to properly remove the overlay click listener if we store its bound reference
    // For now, it's added inline and will be removed when the DOM is destroyed.

    if (this.closeButton && this.boundHideModalHandler) {
      this.closeButton.removeEventListener('click', this.boundHideModalHandler);
      this.boundHideModalHandler = null;
    }
    if (this.modelSelect && this.boundModelChangeHandler) {
      this.modelSelect.removeEventListener('change', this.boundModelChangeHandler);
      this.boundModelChangeHandler = null;
    }
  }

  /**
   * Shows the settings modal. Always destroys previous and creates fresh.
   */
  public showModal(): void {
    this.destroyDOM();
    this.create();
    if (this.modalContainer) {
      this.modalContainer.classList.remove('hidden');
      this.modalContainer.classList.add('visible-block');
    }
  }

  /**
   * Hides the settings modal.
   */
  public hideModal(): void {
    if (this.modalContainer) {
      // this.modalContainer.style.display = 'none';
      this.modalContainer.classList.add('hidden');
      this.modalContainer.classList.remove('visible-block');
    }
  }

  /**
   * Gets the current AI settings.
   * @returns The current AI settings object.
   */
  public getCurrentSettings(): AiSettings {
    if (!this.currentSettings.model) {
      this.currentSettings.model = 'gpt-4o';
    }
    return { ...this.currentSettings };
  }

  /**
   * Destroys the settings modal completely, removing DOM, listeners, and nullifying internal state.
   * Called by core cleanup.
   */
  public destroy(): void {
    this.destroyDOM(); // First remove DOM and listeners
  }
}
