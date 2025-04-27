/**
 * Interface for AI model settings.
 */
export interface AiSettings {
  model: string;
  temperature: number;
}

/**
 * Class for managing the settings modal UI component.
 */
export class SettingsModal {
  private modalContainer: HTMLDivElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private temperatureSelect: HTMLSelectElement | null = null;
  private isCreated: boolean = false; // Reintroduce isCreated flag

  private currentSettings: AiSettings = {
    model: 'gpt-4o-mini',
    temperature: 0.7,
  };

  // Store bound event handlers
  private boundHideModalHandler: (() => void) | null = null;
  private boundModelChangeHandler: ((event: Event) => void) | null = null;
  private boundTempChangeHandler: ((event: Event) => void) | null = null;

  /**
   * Creates a new SettingsModal instance.
   */
  constructor() {
    console.log('[SettingsModal] Constructed. DOM creation deferred until first showModal or create call.');
  }

  /**
   * Creates the settings modal DOM elements if they haven't been created yet,
   * or attaches to existing DOM if found (singleton pattern).
   */
  private create(): void {
    console.log(`[SettingsModal] create() called. isCreated: ${this.isCreated}`);

    // --- Force remove any existing modal container first (for HMR) ---
    const existingModal = document.getElementById('checkra-settings-modal-container');
    if (existingModal?.parentNode) {
      console.warn('[SettingsModal] Found existing modal container. Forcefully removing for HMR compatibility.');
      existingModal.parentNode.removeChild(existingModal);
      // Reset instance state tied to the old DOM
      this.modalContainer = null;
      this.closeButton = null;
      this.modelSelect = null;
      this.temperatureSelect = null;
      this.isCreated = false; // Ensure creation proceeds below
    }
    // --- End Force Remove ---

    // --- Check if already created by this instance (Less likely needed after force remove, but keep for safety) ---
    if (this.isCreated) {
      // This case should ideally not happen if the removal above works.
      console.warn('[SettingsModal] create() called but isCreated flag was true. Resetting and proceeding.');
      this.isCreated = false; // Ensure creation proceeds
      // DO NOT return here, let it create the new DOM.
    }

    // --- Check document.body readiness ---
    if (!document.body) {
      console.error('[SettingsModal] Cannot create modal: document.body is not available yet.');
      return; // Exit if body not ready
    }
    console.log('[SettingsModal] Document body ready, proceeding with DOM creation.');

    // --- Create Modal Container ---
    this.modalContainer = document.createElement('div');
    this.modalContainer.id = 'checkra-settings-modal-container';
    this.modalContainer.style.position = 'fixed';
    this.modalContainer.style.top = '50%';
    this.modalContainer.style.left = '50%';
    this.modalContainer.style.transform = 'translate(-50%, -50%)';
    this.modalContainer.style.backgroundColor = 'rgba(35, 45, 75, 0.95)';
    this.modalContainer.style.color = 'white';
    this.modalContainer.style.padding = '20px';
    this.modalContainer.style.borderRadius = '8px';
    this.modalContainer.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.4)';
    this.modalContainer.style.zIndex = '1001';
    this.modalContainer.style.display = 'none'; // Initially hidden
    this.modalContainer.style.minWidth = '300px';
    this.modalContainer.style.fontFamily = 'sans-serif';

    // --- Create Header ---
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
    header.style.paddingBottom = '10px';

    const title = document.createElement('h2');
    title.textContent = 'AI Settings';
    title.style.margin = '0';
    title.style.fontSize = '16px';

    this.closeButton = document.createElement('button');
    this.closeButton.innerHTML = '&times;';
    this.closeButton.style.background = 'none';
    this.closeButton.style.border = 'none';
    this.closeButton.style.color = 'white';
    this.closeButton.style.fontSize = '1.8em';
    this.closeButton.style.lineHeight = '1';
    this.closeButton.style.cursor = 'pointer';
    this.closeButton.style.padding = '0 5px';
    this.closeButton.title = 'Close Settings';

    header.appendChild(title);
    header.appendChild(this.closeButton);

    // --- Create Content Area ---
    const content = document.createElement('div');

    // --- Model Select ---
    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'AI model:';
    modelLabel.style.display = 'block';
    modelLabel.style.fontSize = '14px';
    modelLabel.style.marginBottom = '5px';
    modelLabel.htmlFor = 'checkra-ai-model-select';

    this.modelSelect = document.createElement('select');
    this.modelSelect.id = 'checkra-ai-model-select';
    this.modelSelect.style.width = '100%';
    this.modelSelect.style.padding = '8px';
    this.modelSelect.style.borderRadius = '4px';
    this.modelSelect.style.border = '1px solid #ccc';
    this.modelSelect.style.backgroundColor = '#fff';
    this.modelSelect.style.color = '#333';

    console.log("SETTING AI MODELS")
    const modelOptions = ['gpt-4o-mini'];
    modelOptions.forEach(optionText => {
      const option = document.createElement('option');
      option.value = optionText.toLowerCase().replace(/ /g, '-');
      option.textContent = optionText;
      if (option.value === this.currentSettings.model) {
        option.selected = true;
      }
      this.modelSelect?.appendChild(option);
    });

    content.appendChild(modelLabel);
    content.appendChild(this.modelSelect);

    const tempLabel = document.createElement('label');
    tempLabel.textContent = 'Temperature:';
    tempLabel.style.display = 'block';
    tempLabel.style.marginBottom = '5px';
    tempLabel.style.fontSize = '14px';
    tempLabel.style.marginTop = '15px';
    tempLabel.htmlFor = 'checkra-ai-temperature-select';

    this.temperatureSelect = document.createElement('select');
    this.temperatureSelect.id = 'checkra-ai-temperature-select';
    this.temperatureSelect.style.width = '100%';
    this.temperatureSelect.style.padding = '8px';
    this.temperatureSelect.style.borderRadius = '4px';
    this.temperatureSelect.style.border = '1px solid #ccc';
    this.temperatureSelect.style.backgroundColor = '#fff';
    this.temperatureSelect.style.color = '#333';

    console.log("SETTING TEMPERATURE OPTIONS");

    // Define temperature options with descriptions
    const tempOptions = [
      { value: 0.1, text: "0.1 - Highly Focused & Deterministic" },
      { value: 0.35, text: "0.35 - Focused & Consistent" },
      { value: 0.6, text: "0.6 - Balanced & Reliable" }, // Close to previous default 0.7
      { value: 0.85, text: "0.85 - Creative & Flexible" },
      { value: 1.1, text: "1.1 - More Creative & Diverse" },
      { value: 1.35, text: "1.35 - Highly Creative & Exploratory" },
      { value: 1.6, text: "1.6 - Very Experimental & Unpredictable" },
      { value: 1.85, text: "1.85 - Maximal Randomness & Potentially Incoherent" },
      { value: 2.0, text: "2.0 - Extremely Random & Abstract" },
    ];

    tempOptions.forEach(tempData => {
      const option = document.createElement('option');
      option.value = String(tempData.value);
      option.textContent = tempData.text; // Use the combined text

      // Set selected based on current settings AFTER creating the option
      // Use a small tolerance for floating point comparison
      if (Math.abs(tempData.value - this.currentSettings.temperature) < 0.01) {
        option.selected = true;
      }

      // Check *again* right before appendChild, just to be super safe
      if (this.temperatureSelect) {
        this.temperatureSelect.appendChild(option);
      } else {
         // This log should ideally never appear now if the outer check passed
         console.error('[SettingsModal] CRITICAL during temp population: this.temperatureSelect became null!');
      }
    });

     // Find the closest option value to the current setting and select it
     let closestValue = tempOptions[0].value;
     let minDiff = Math.abs(closestValue - this.currentSettings.temperature);

     for (const tempData of tempOptions) {
       const diff = Math.abs(tempData.value - this.currentSettings.temperature);
       if (diff < minDiff) {
         minDiff = diff;
         closestValue = tempData.value;
       }
     }
     this.temperatureSelect.value = String(closestValue);

    content.appendChild(tempLabel);
    content.appendChild(this.temperatureSelect);

    this.modalContainer.appendChild(header);
    this.modalContainer.appendChild(content);

    // --- Populate select options AFTER they are part of the container ---
    this._populateSelectOptions();

    // --- Append modal container to body ---
    document.body.appendChild(this.modalContainer);

    // --- Attach Listeners ---
    this.attachListeners();

    this.isCreated = true;
    console.log('[SettingsModal] create() finished successfully.');
  }

  /**
   * Populates the model and temperature select dropdowns with options.
   * Should be called after the select elements have been created and added to modalContainer.
   */
  private _populateSelectOptions(): void {
    console.log('[SettingsModal] _populateSelectOptions() called.');

    // --- Populate Model Select ---
    if (this.modelSelect) {
      // Clear existing options first (important for HMR/re-creation)
      this.modelSelect.innerHTML = '';
      console.log("SETTING AI MODELS")
      const modelOptions = ['gpt-4o-mini']; // Hardcoded for now
      modelOptions.forEach(optionText => {
        const option = document.createElement('option');
        option.value = optionText.toLowerCase().replace(/ /g, '-');
        option.textContent = optionText;
        // Set selected based on current settings AFTER creating the option
        if (option.value === this.currentSettings.model) {
          option.selected = true;
        }
        this.modelSelect?.appendChild(option); // Optional chaining just in case
      });
    } else {
       console.error('[SettingsModal] Cannot populate models: this.modelSelect is null.');
    }

    // --- Populate Temperature Select ---
    if (this.temperatureSelect) {
      // Clear existing options first
      this.temperatureSelect.innerHTML = '';
      console.log("SETTING TEMPERATURE OPTIONS");

      // Define temperature options with descriptions
      const tempOptions = [
        { value: 0.1, text: "0.1 - Highly Focused & Deterministic" },
        { value: 0.35, text: "0.35 - Focused & Consistent" },
        { value: 0.6, text: "0.6 - Balanced & Reliable" }, // Close to previous default 0.7
        { value: 0.85, text: "0.85 - Creative & Flexible" },
        { value: 1.1, text: "1.1 - More Creative & Diverse" },
        { value: 1.35, text: "1.35 - Highly Creative & Exploratory" },
        { value: 1.6, text: "1.6 - Very Experimental & Unpredictable" },
        { value: 1.85, text: "1.85 - Maximal Randomness & Potentially Incoherent" },
        { value: 2.0, text: "2.0 - Extremely Random & Abstract" },
      ];

      tempOptions.forEach(tempData => {
        const option = document.createElement('option');
        option.value = String(tempData.value);
        option.textContent = tempData.text; // Use the combined text

        // Set selected based on current settings AFTER creating the option
        // Use a small tolerance for floating point comparison
        if (Math.abs(tempData.value - this.currentSettings.temperature) < 0.01) {
          option.selected = true;
        }

        // Check *again* right before appendChild, just to be super safe
        if (this.temperatureSelect) {
          this.temperatureSelect.appendChild(option);
        } else {
           // This log should ideally never appear now if the outer check passed
           console.error('[SettingsModal] CRITICAL during temp population: this.temperatureSelect became null!');
        }
      });

       // Find the closest option value to the current setting and select it
       let closestValue = tempOptions[0].value;
       let minDiff = Math.abs(closestValue - this.currentSettings.temperature);

       for (const tempData of tempOptions) {
         const diff = Math.abs(tempData.value - this.currentSettings.temperature);
         if (diff < minDiff) {
           minDiff = diff;
           closestValue = tempData.value;
         }
       }
       this.temperatureSelect.value = String(closestValue);

    } else {
      console.error('[SettingsModal] Cannot populate temperature: this.temperatureSelect is null.');
    }
     console.log('[SettingsModal] _populateSelectOptions() finished.');
  }

  /**
   * Attaches event listeners to the DOM elements.
   */
  private attachListeners(): void {
    if (!this.closeButton || !this.modelSelect || !this.temperatureSelect) {
      console.error(`[SettingsModal] Cannot attach listeners: elements not found.`);
      return;
    }

    this.removeListeners(); // Ensure no duplicates

    // Create and store bound handlers
    this.boundHideModalHandler = this.hideModal.bind(this);
    this.boundModelChangeHandler = (event: Event) => {
      const selectedModel = (event.target as HTMLSelectElement).value;
      this.currentSettings.model = selectedModel;
      console.log(`[Settings] Selected model: ${this.currentSettings.model}`);
    };
    this.boundTempChangeHandler = (event: Event) => {
      const selectedTemp = parseFloat((event.target as HTMLSelectElement).value);
      if (!isNaN(selectedTemp)) {
        this.currentSettings.temperature = selectedTemp;
        console.log(`[Settings] Selected temperature: ${this.currentSettings.temperature}`);
      } else {
        console.warn(`[Settings] Invalid temperature value selected: ${(event.target as HTMLSelectElement).value}`);
      }
    };

    // Add listeners using the stored handlers
    this.closeButton.addEventListener('click', this.boundHideModalHandler);
    this.modelSelect.addEventListener('change', this.boundModelChangeHandler);
    this.temperatureSelect.addEventListener('change', this.boundTempChangeHandler);

    console.log(`[SettingsModal] Event listeners attached.`);
  }

  /**
   * Removes event listeners from the DOM elements.
   */
  private removeListeners(): void {
    if (this.closeButton && this.boundHideModalHandler) {
      this.closeButton.removeEventListener('click', this.boundHideModalHandler);
      this.boundHideModalHandler = null; // Clean up handler ref
    }
    if (this.modelSelect && this.boundModelChangeHandler) {
      this.modelSelect.removeEventListener('change', this.boundModelChangeHandler);
      this.boundModelChangeHandler = null; // Clean up handler ref
    }
    if (this.temperatureSelect && this.boundTempChangeHandler) {
      this.temperatureSelect.removeEventListener('change', this.boundTempChangeHandler);
      this.boundTempChangeHandler = null; // Clean up handler ref
    }
    // console.log('[SettingsModal] Event listeners removed.');
  }

  /**
   * Shows the settings modal. Creates the DOM via create() if it doesn't exist yet.
   */
  public showModal(): void {
    console.log(`[SettingsModal] showModal() called. isCreated: ${this.isCreated}`);

    // --- Ensure DOM is created --- //
    if (!this.isCreated) {
      console.log(`[SettingsModal] Not created yet, calling create()...`);
      this.create();
      // If create() failed (e.g., body not ready), isCreated will still be false
      if (!this.isCreated) {
        console.error(`[SettingsModal] create() failed or did not complete. Cannot show modal.`);
        return; // Abort showing if creation failed
      }
    }

    // --- Proceed only if DOM exists and instance is marked as created --- //
    if (this.modalContainer) {
      console.log(`[SettingsModal] Modal container exists, proceeding to show.`);
      // Ensure latest settings are reflected in dropdowns when showing
      if (this.modelSelect) this.modelSelect.value = this.currentSettings.model;
      if (this.temperatureSelect) {
        let bestMatch = '';
        let minDiff = Infinity;
        for (const option of Array.from(this.temperatureSelect.options)) {
          const value = parseFloat(option.value);
          if (!isNaN(value)) {
            const diff = Math.abs(value - this.currentSettings.temperature);
            if (diff < minDiff) {
              minDiff = diff;
              bestMatch = option.value;
            }
          }
        }
        this.temperatureSelect.value = bestMatch || String(this.currentSettings.temperature);
      }


      if (this.modalContainer) { // Re-check in case destroyed during delay
        this.modalContainer.style.display = 'block';
        console.log(`[SettingsModal] Modal shown successfully after delay.`);
      } else {
        console.warn(`[SettingsModal] Modal container became null during show delay. Aborting show.`);
      }

    } else {
      // Log error if container is still null after attempting build
      console.error(`[SettingsModal] showModal() failed: isCreated is true, but modalContainer is null!`);
    }
  }

  /**
   * Hides the settings modal.
   */
  public hideModal(): void {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'none';
      console.log(`[SettingsModal] Modal hidden.`);
    }
  }

  /**
   * Gets the current AI settings.
   * @returns The current AI settings object.
   */
  public getCurrentSettings(): AiSettings {
    if (!this.currentSettings.model) {
      this.currentSettings.model = 'gpt-4o-mini';
    }
    if (this.currentSettings.temperature === undefined || this.currentSettings.temperature === null || isNaN(this.currentSettings.temperature)) {
      this.currentSettings.temperature = 0.7;
    }
    return { ...this.currentSettings };
  }

  /**
   * Destroys the settings modal, removing it from the DOM and cleaning up listeners.
   */
  public destroy(): void {
    console.log(`[SettingsModal] destroy() called.`);
    this.removeListeners();

    // Attempt to remove the element by ID for robustness against multiple instances
    const modalElement = document.getElementById('checkra-settings-modal-container');
    if (modalElement?.parentNode) {
      console.log(`[SettingsModal] Removing modal container from DOM.`);
      modalElement.parentNode.removeChild(modalElement);
    } else {
      console.log(`[SettingsModal] Modal container not found in DOM (already removed or never added).`);
    }

    // Clear references for *this* instance
    this.modalContainer = null;
    this.closeButton = null;
    this.modelSelect = null;
    this.temperatureSelect = null;
    this.isCreated = false; // Reset flag

    console.log(`[SettingsModal] Instance state cleared.`);
  }
}

// Export instance - relies on module system for singleton behavior
export const settingsViewer = new SettingsModal();
