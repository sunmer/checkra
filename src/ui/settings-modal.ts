/**
 * Class for managing the settings modal UI component.
 */
class SettingsModal {
  private modalContainer: HTMLDivElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;

  /**
   * Creates a new SettingsModal instance and initializes the modal element.
   */
  constructor() {
    this.create();
  }

  /**
   * Creates the settings modal DOM elements.
   */
  private create(): void {
    // Prevent creating multiple modals
    if (document.getElementById('settings-modal-container')) {
      return;
    }

    // Create modal container
    this.modalContainer = document.createElement('div');
    this.modalContainer.id = 'settings-modal-container';
    // Basic modal styling (similar to a potential feedback viewer)
    this.modalContainer.style.position = 'fixed';
    this.modalContainer.style.top = '50%';
    this.modalContainer.style.left = '50%';
    this.modalContainer.style.transform = 'translate(-50%, -50%)';
    this.modalContainer.style.backgroundColor = 'rgba(35, 45, 75, 0.95)';
    this.modalContainer.style.color = 'white';
    this.modalContainer.style.padding = '20px';
    this.modalContainer.style.borderRadius = '8px';
    this.modalContainer.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.4)';
    this.modalContainer.style.zIndex = '1001'; // Ensure it's above the floating menu
    this.modalContainer.style.display = 'none'; // Initially hidden
    this.modalContainer.style.minWidth = '300px';
    this.modalContainer.style.fontFamily = 'sans-serif';

    // Create modal header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '15px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
    header.style.paddingBottom = '10px';

    // Create title
    const title = document.createElement('h2');
    title.textContent = 'Select model';
    title.style.margin = '0';
    title.style.fontSize = '1.2em';

    // Create close button
    this.closeButton = document.createElement('button');
    this.closeButton.innerHTML = '&times;'; // 'X' symbol
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

    // Create modal content area
    const content = document.createElement('div');

    // Create label for the select dropdown
    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'AI Model:';
    selectLabel.style.display = 'block';
    selectLabel.style.marginBottom = '5px';
    selectLabel.htmlFor = 'ai-model-select'; // Associate label with select

    // Create select dropdown
    this.modelSelect = document.createElement('select');
    this.modelSelect.id = 'ai-model-select';
    this.modelSelect.style.width = '100%';
    this.modelSelect.style.padding = '8px';
    this.modelSelect.style.borderRadius = '4px';
    this.modelSelect.style.border = '1px solid #ccc';
    this.modelSelect.style.backgroundColor = '#fff'; // White background for dropdown
    this.modelSelect.style.color = '#333'; // Dark text for options

    // Add options to the select dropdown (example options)
    const options = ['Gemini 1.5 Pro', 'GPT-4o', 'Claude 3 Opus'];
    options.forEach(optionText => {
      const option = document.createElement('option');
      option.value = optionText.toLowerCase().replace(/ /g, '-');
      option.textContent = optionText;
      this.modelSelect?.appendChild(option);
    });

    // Add change listener (optional - for immediate action on select)
    this.modelSelect.addEventListener('change', (event) => {
      const selectedModel = (event.target as HTMLSelectElement).value;
      console.log(`[Settings] Selected model: ${selectedModel}`);
      // TODO: Add logic to handle model change (e.g., save preference)
    });

    content.appendChild(selectLabel);
    content.appendChild(this.modelSelect);

    // Assemble modal
    this.modalContainer.appendChild(header);
    this.modalContainer.appendChild(content);

    // Append to body (initially hidden)
    document.body.appendChild(this.modalContainer);
  }

  /**
   * Shows the settings modal.
   */
  public showModal(): void {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'block';
      console.log('[Settings] Modal shown.');
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
        // Simple removal is often enough if no complex external listeners exist
        this.closeButton.removeEventListener('click', this.hideModal);
    }
     if (this.modelSelect) {
        this.modelSelect.removeEventListener('change', (event) => { /* reference needed or anonymous */ });
        // Note: Removing anonymous listeners like this is tricky.
        // It's often better to store the listener function reference if precise removal is needed.
        // Or rely on removing the parent node.
    }

    if (this.modalContainer?.parentNode) {
      this.modalContainer.parentNode.removeChild(this.modalContainer);
    }

    // Nullify references
    this.modalContainer = null;
    this.closeButton = null;
    this.modelSelect = null;
    console.log('[Settings] Modal destroyed.');
  }
}

// Export a singleton instance
export const settingsViewer = new SettingsModal();
