export function createCenteredLoaderElement(): HTMLDivElement {
    const loaderOuter = document.createElement('div');
    loaderOuter.className = 'checkra-replace-loader'; // Positioned container

    const spinnerInner = document.createElement('div');
    spinnerInner.className = 'checkra-spinner-inner'; // Actual spinning element with border
    loaderOuter.appendChild(spinnerInner);

    return loaderOuter;
} 