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
  private temperatureSlider: HTMLInputElement | null = null;
  private temperatureDescriptionDisplay: HTMLParagraphElement | null = null;

  private currentSettings: AiSettings = {
    model: 'o4-mini',
    temperature: 0.7,
  };

  // Map temperature values to descriptions
  private tempValueToDescription: { [key: number]: { description: string; step: number } } = {
    0.2: { description: "Clear & Reliable", step: 0.3 },       // For precise, conversion-focused copy
    0.5: { description: "Balanced & Engaging", step: 0.5 },    // A good mix of creativity and clarity
    1.0: { description: "Creative & Bold", step: 0.2 },        // For more experimental, eye-catching outputs
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

    // --- Temperature Slider --- // Modify this section
    const tempLabel = document.createElement('label');
    tempLabel.textContent = 'Creativity:'; // Updated label
    tempLabel.htmlFor = 'checkra-ai-temperature-slider'; // Changed ID ref

    this.temperatureSlider = document.createElement('input');
    this.temperatureSlider.type = 'range';
    this.temperatureSlider.id = 'checkra-ai-temperature-slider';

    const tempValues = Object.keys(this.tempValueToDescription).map(parseFloat).sort((a, b) => a - b);
    this.temperatureSlider.min = String(tempValues[0]);
    this.temperatureSlider.max = String(tempValues[tempValues.length - 1]);
    
    // Dynamically find the initial value and step
    const initialTemp = this._getClosestValue(this.currentSettings.temperature, tempValues);
    this.temperatureSlider.value = String(initialTemp);
    this.currentSettings.temperature = initialTemp;
    
    // Find the step corresponding to the next value, or use the last step
    const currentIndex = tempValues.indexOf(initialTemp);
    const nextIndex = Math.min(currentIndex + 1, tempValues.length - 1);
    const step = this.tempValueToDescription[tempValues[nextIndex]].step || 0.1;
    this.temperatureSlider.step = String(step);

    this.temperatureDescriptionDisplay = document.createElement('p');
    this.temperatureDescriptionDisplay.id = 'checkra-ai-temperature-description';
    this.temperatureDescriptionDisplay.textContent = this._getTemperatureDescription(initialTemp);

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
      const modelOptions = ['o4-mini'];
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
   * Helper to get the description for a given temperature value.
   * Reverted to original logic.
   */
  private _getTemperatureDescription(value: number): string {
    const tempValue = this._getClosestValue(value, Object.keys(this.tempValueToDescription).map(parseFloat));
    const entry = this.tempValueToDescription[tempValue];
    return entry ? `${entry.description} (${tempValue.toFixed(1)})` : "Unknown Setting";
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
      eventEmitter.emit('settingsChanged', { ...this.currentSettings });
    };
    this.boundTempSliderHandler = (event: Event) => {
      const slider = event.target as HTMLInputElement;
      const selectedTemp = parseFloat(slider.value);
      if (!isNaN(selectedTemp)) {
          this.currentSettings.temperature = selectedTemp;
          if (this.temperatureDescriptionDisplay) {
              this.temperatureDescriptionDisplay.textContent = this._getTemperatureDescription(selectedTemp);
          }
          eventEmitter.emit('settingsChanged', { ...this.currentSettings });

          // Dynamically update the slider's step for non-linear behavior
          const tempValues = Object.keys(this.tempValueToDescription).map(parseFloat).sort((a, b) => a - b);
          const currentIndex = tempValues.indexOf(this._getClosestValue(selectedTemp, tempValues));
          const nextIndex = Math.min(currentIndex + 1, tempValues.length - 1);
          const nextStep = this.tempValueToDescription[tempValues[nextIndex]].step;
          if (nextStep) {
            slider.step = String(nextStep);
          }
      } else {
          console.warn(`[Settings] Invalid temperature value from slider: ${slider.value}`);
      }
    };
    const boundOverlayClickHandler = (event: MouseEvent) => {
      if (this.modalContainer && event.target === this.modalContainer) {
        event.stopPropagation(); // Prevent click from reaching document listener
        this.hideModal();
      }
    };

    this.closeButton.addEventListener('click', this.boundHideModalHandler);
    this.modelSelect.addEventListener('change', this.boundModelChangeHandler);
    this.temperatureSlider.addEventListener('input', this.boundTempSliderHandler);
    this.modalContainer?.addEventListener('click', boundOverlayClickHandler);
  }

  /**
   * Removes event listeners from the DOM elements.
   */
  private removeListeners(): void {
    if (this.boundHideModalHandler) {
      this.closeButton?.removeEventListener('click', this.boundHideModalHandler);
    }
    if (this.boundModelChangeHandler) {
      this.modelSelect?.removeEventListener('change', this.boundModelChangeHandler);
    }
    if (this.boundTempSliderHandler) {
      this.temperatureSlider?.removeEventListener('input', this.boundTempSliderHandler);
    }
  }

  /**
   * Shows the settings modal. Always destroys previous and creates fresh.
   */
  public showModal(): void {
    this.destroyDOM();
    this.create();
    if (this.modalContainer) {
      // Ensure it shows regardless of CSS default "display: none"
      this.modalContainer.classList.remove('checkra-hidden');
      this.modalContainer.classList.add('checkra-visible');
      this.modalContainer.style.display = 'block';
    }
  }

  /**
   * Hides the settings modal.
   */
  public hideModal(): void {
    if (this.modalContainer) {
      // this.modalContainer.style.display = 'none';
      this.modalContainer.classList.add('checkra-hidden');
      this.modalContainer.classList.remove('checkra-visible');
      this.modalContainer.style.display = 'none';
    }
  }

  /**
   * Gets the current AI settings.
   * @returns The current AI settings object.
   */
  public getCurrentSettings(): AiSettings {
    if (!this.currentSettings.model) {
      this.currentSettings.model = 'o4-mini';
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

  /**
   * Helper to find the closest value in an array to a given target.
   */
  private _getClosestValue(target: number, values: number[]): number {
    let closest = values[0];
    let minDistance = Math.abs(target - closest);

    for (let i = 1; i < values.length; i++) {
      const currentDistance = Math.abs(target - values[i]);
      if (currentDistance < minDistance) {
        closest = values[i];
        minDistance = currentDistance;
      }
    }

    return closest;
  }
}
