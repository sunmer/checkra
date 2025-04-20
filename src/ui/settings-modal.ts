/**
 * Class for managing the settings modal UI component.
 */
class SettingsModal {
  private modalContainer: HTMLDivElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private isCreated: boolean = false;

  /**
   * Creates a new SettingsModal instance.
   */
  constructor() {
    console.log('[SettingsModal] Constructed, DOM not created yet.');
  }

  /**
   * Creates the settings modal DOM elements if they haven't been created yet.
   */
  private create(): void {
    if (this.isCreated || document.getElementById('settings-modal-container')) {
        this.isCreated = true;
        this.modalContainer = document.getElementById('settings-modal-container') as HTMLDivElement | null;
        return;
    }

    if (!document.body) {
        console.error('[SettingsModal] Cannot create modal: document.body is not available yet.');
        return;
    }

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
    this.modalContainer.style.display = 'none';
    this.modalContainer.style.minWidth = '300px';
    this.modalContainer.style.fontFamily = 'sans-serif';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
    header.style.paddingBottom = '10px';

    const title = document.createElement('h2');
    title.textContent = 'Select model';
    title.style.margin = '0';
    title.style.fontSize = '1.2em';

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
    this.closeButton.addEventListener('click', () => this.hideModal());

    header.appendChild(title);
    header.appendChild(this.closeButton);

    const content = document.createElement('div');

    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'AI Model:';
    selectLabel.style.display = 'block';
    selectLabel.style.marginBottom = '5px';
    selectLabel.htmlFor = 'ai-model-select';

    this.modelSelect = document.createElement('select');
    this.modelSelect.id = 'checkra-ai-model-select';
    this.modelSelect.style.width = '100%';
    this.modelSelect.style.padding = '8px';
    this.modelSelect.style.borderRadius = '4px';
    this.modelSelect.style.border = '1px solid #ccc';
    this.modelSelect.style.backgroundColor = '#fff';
    this.modelSelect.style.color = '#333';

    const options = ['Gemini 1.5 Pro', 'GPT-4o', 'Claude 3 Opus'];
    options.forEach(optionText => {
      const option = document.createElement('option');
      option.value = optionText.toLowerCase().replace(/ /g, '-');
      option.textContent = optionText;
      this.modelSelect?.appendChild(option);
    });

    this.modelSelect.addEventListener('change', (event) => {
      const selectedModel = (event.target as HTMLSelectElement).value;
      console.log(`[Settings] Selected model: ${selectedModel}`);
      // TODO: Add logic to handle model change (e.g., save preference)
    });

    content.appendChild(selectLabel);
    content.appendChild(this.modelSelect);

    this.modalContainer.appendChild(header);
    this.modalContainer.appendChild(content);

    document.body.appendChild(this.modalContainer);

    this.isCreated = true;
    console.log('[SettingsModal] DOM created.');
  }

  /**
   * Shows the settings modal. Creates the DOM if it doesn't exist yet.
   */
  public showModal(): void {
    if (!this.isCreated) {
      this.create();
    }

    if (this.modalContainer) {
      this.modalContainer.style.display = 'block';
      console.log('[Settings] Modal shown.');
    } else if (!this.isCreated) {
      console.error('[SettingsModal] Cannot show modal because creation failed earlier.');
    }
  }

  /**
   * Hides the settings modal.
   */
  public hideModal(): void {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'none';
      console.log('[Settings] Modal hidden.');
    }
  }

  /**
   * Destroys the settings modal, removing it from the DOM and cleaning up listeners.
   */
  public destroy(): void {
    if (this.closeButton) {
       const hideModalHandler = () => this.hideModal();
       this.closeButton.removeEventListener('click', hideModalHandler);
    }

    if (this.modalContainer?.parentNode) {
      this.modalContainer.parentNode.removeChild(this.modalContainer);
    }

    this.modalContainer = null;
    this.closeButton = null;
    this.modelSelect = null;
    this.isCreated = false;
    console.log('[Settings] Modal destroyed.');
  }
}

export const settingsViewer = new SettingsModal();
