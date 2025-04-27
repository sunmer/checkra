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
  private temperatureSlider: HTMLInputElement | null = null;
  private temperatureDescriptionDisplay: HTMLParagraphElement | null = null;

  private currentSettings: AiSettings = {
    model: 'gpt-4o-mini',
    temperature: 0.7,
  };

  // Map temperature values to descriptions - Updated for 0.0-1.2 range, step 0.2
  private tempValueToDescription: { [key: number]: string } = {
    0.0: "Deterministic",
    0.2: "Focused",
    0.4: "Creative",
    0.6: "Imaginative",
    0.8: "More Creative",
    1.0: "Wild",
    1.2: "Chaotic"
  };

  // Store bound event handlers
  private boundHideModalHandler: (() => void) | null = null;
  private boundModelChangeHandler: ((event: Event) => void) | null = null;
  private boundTempSliderHandler: ((event: Event) => void) | null = null;

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
    this.temperatureSlider = null;
    this.temperatureDescriptionDisplay = null;
  }

  /**
   * Creates the settings modal DOM elements.
   * Assumes any previous modal has been destroyed.
   */
  private create(): void {
    // console.log('[SettingsModal] ENTERING create()');

    // --- Check document.body readiness --- //
    if (!document.body) {
      console.error('[SettingsModal] Cannot create modal: document.body is not available yet.');
      return; // Exit if body not ready
    }
    // console.log('[SettingsModal] Document body ready, proceeding with DOM creation.');

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
    this.modalContainer.style.display = 'none'; // Keep initially hidden, showModal will change this
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

    content.appendChild(modelLabel);
    content.appendChild(this.modelSelect);

    // --- Temperature Slider --- // Modify this section
    const tempLabel = document.createElement('label');
    tempLabel.textContent = 'Creativity:'; // Updated label
    tempLabel.style.display = 'block';
    tempLabel.style.marginBottom = '5px';
    tempLabel.style.fontSize = '14px';
    tempLabel.style.marginTop = '15px';
    tempLabel.htmlFor = 'checkra-ai-temperature-slider'; // Changed ID ref

    this.temperatureSlider = document.createElement('input');
    this.temperatureSlider.type = 'range';
    this.temperatureSlider.id = 'checkra-ai-temperature-slider';
    this.temperatureSlider.min = '0.0'; // Updated min
    this.temperatureSlider.max = '1.2'; // Updated max
    this.temperatureSlider.step = '0.2'; // Updated step
    this.temperatureSlider.style.width = '100%';
    this.temperatureSlider.style.cursor = 'pointer';

    // Find the closest step to the current setting using updated range/step
    const closestTempValue = this._findClosestStep(
        this.currentSettings.temperature,
        0.0,
        1.2,
        0.2
    );
    this.temperatureSlider.value = String(closestTempValue);
    // Update the setting itself to the snapped value
    this.currentSettings.temperature = closestTempValue;


    this.temperatureDescriptionDisplay = document.createElement('p');
    this.temperatureDescriptionDisplay.id = 'checkra-ai-temperature-description';
    this.temperatureDescriptionDisplay.style.textAlign = 'center';
    this.temperatureDescriptionDisplay.style.fontSize = '12px';
    this.temperatureDescriptionDisplay.style.marginTop = '5px';
    this.temperatureDescriptionDisplay.style.color = 'rgba(255, 255, 255, 0.8)';
    // Initial description uses updated range/step via helper
    this.temperatureDescriptionDisplay.textContent = this._getTemperatureDescription(closestTempValue);


    content.appendChild(tempLabel);
    content.appendChild(this.temperatureSlider); // Add slider
    content.appendChild(this.temperatureDescriptionDisplay); // Add description display


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
    // console.log('[SettingsModal] ENTERING _populateSelectOptions()');

    // --- Populate Model Select --- //
    // console.log('[SettingsModal] Populating models...');
    if (this.modelSelect) {
      this.modelSelect.innerHTML = '';
      // console.log("SETTING AI MODELS")
      const modelOptions = ['gpt-4o-mini']; // Hardcoded for now
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
   * Helper to find the closest valid step for the slider.
   */
  private _findClosestStep(value: number, min: number, max: number, step: number): number {
      if (value <= min) return min;
      if (value >= max) return max;
      // Calculate the nearest step index
      const steps = Math.round((value - min) / step);
      let closest = min + steps * step;
      // Clamp to max/min just in case
      closest = Math.min(max, Math.max(min, closest));
      // Round to handle potential floating point inaccuracies with step
      const precision = (step.toString().split('.')[1] || '').length;
      return parseFloat(closest.toFixed(precision));
  }

  /**
   * Helper to get the description for a given temperature value.
   * Reverted to original logic.
   */
  private _getTemperatureDescription(value: number): string {
      // Use the closest step value to look up in the map, using updated range/step
      const closestStep = this._findClosestStep(value, 0.0, 1.2, 0.2); // Updated args
      const description = this.tempValueToDescription[closestStep] || "Unknown Setting"; // Use updated map
      // Format the output string to include the value
      return `${description} (${closestStep.toFixed(1)})`;
  }

  /**
   * Attaches event listeners to the DOM elements.
   */
  private attachListeners(): void {
    if (!this.closeButton || !this.modelSelect || !this.temperatureSlider || !this.temperatureDescriptionDisplay) {
      console.error(`[SettingsModal] Cannot attach listeners: elements not found.`);
      return;
    }

    this.removeListeners();

    this.boundHideModalHandler = this.hideModal.bind(this);
    this.boundModelChangeHandler = (event: Event) => {
      const selectedModel = (event.target as HTMLSelectElement).value;
      this.currentSettings.model = selectedModel;
    };
    this.boundTempSliderHandler = (event: Event) => {
      const slider = event.target as HTMLInputElement;
      const selectedTemp = parseFloat(slider.value);
      if (!isNaN(selectedTemp)) {
          this.currentSettings.temperature = selectedTemp;
          if (this.temperatureDescriptionDisplay) {
              this.temperatureDescriptionDisplay.textContent = this._getTemperatureDescription(selectedTemp);
          }
          console.log(`[SettingsModal] Slider handler updated temperature to: ${this.currentSettings.temperature}`);
      } else {
          console.warn(`[Settings] Invalid temperature value from slider: ${slider.value}`);
      }
    };

    this.closeButton.addEventListener('click', this.boundHideModalHandler);
    this.modelSelect.addEventListener('change', this.boundModelChangeHandler);
    this.temperatureSlider.addEventListener('input', this.boundTempSliderHandler);

    // console.log(`[SettingsModal] Event listeners attached.`);
  }

  /**
   * Removes event listeners from the DOM elements.
   */
  private removeListeners(): void {
    if (this.closeButton && this.boundHideModalHandler) {
      this.closeButton.removeEventListener('click', this.boundHideModalHandler);
      this.boundHideModalHandler = null;
    }
    if (this.modelSelect && this.boundModelChangeHandler) {
      this.modelSelect.removeEventListener('change', this.boundModelChangeHandler);
      this.boundModelChangeHandler = null;
    }
    if (this.temperatureSlider && this.boundTempSliderHandler) {
        this.temperatureSlider.removeEventListener('input', this.boundTempSliderHandler);
        this.boundTempSliderHandler = null;
    }
  }

  /**
   * Shows the settings modal. Always destroys previous and creates fresh.
   */
  public showModal(): void {
    // console.log(`[SettingsModal] ENTERING showModal()`);

    // --- 1. Destroy any existing modal first --- //
    this.destroyDOM();

    // --- 2. Create the new modal DOM --- //
    this.create();

    // --- 3. Show the newly created modal (if creation succeeded) --- //
    if (this.modalContainer) {
      this.modalContainer.style.display = 'block';
    }
  }

  /**
   * Hides the settings modal.
   */
  public hideModal(): void {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'none';
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
