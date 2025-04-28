import './settings-modal.css';

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
    model: 'gpt-4o',
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

    const header = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = 'AI Settings';

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

    // --- Temperature Slider --- // Modify this section
    const tempLabel = document.createElement('label');
    tempLabel.textContent = 'Creativity:'; // Updated label
    tempLabel.htmlFor = 'checkra-ai-temperature-slider'; // Changed ID ref

    this.temperatureSlider = document.createElement('input');
    this.temperatureSlider.type = 'range';
    this.temperatureSlider.id = 'checkra-ai-temperature-slider';
    this.temperatureSlider.min = '0.0'; // Updated min
    this.temperatureSlider.max = '1.2'; // Updated max
    this.temperatureSlider.step = '0.2'; // Updated step

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

    if (this.modelSelect) {
      this.modelSelect.innerHTML = '';
      const modelOptions = ['gpt-4o', 'gpt-4o-mini'];
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
