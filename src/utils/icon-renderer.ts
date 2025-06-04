import { customWarn } from './logger'; // Assuming logger is in utils

/**
 * Renders Lucide icons by replacing <i data-lucide="..."> placeholders with SVGs.
 * This function should be called after any DOM manipulations that might add new icon placeholders.
 */
export async function renderLucideIcons(): Promise<void> {
  try {
    const lucideModule = await import('lucide-static');

    // Directly use the structure indicated by linter feedback
    if (lucideModule && lucideModule.default && typeof (lucideModule.default as any).Replace === 'function') {
      (lucideModule.default as any).Replace();
    } else {
      customWarn('[IconRenderer] lucide-static `default.Replace` function not found. Icons may not render. Module structure:', lucideModule);
    }
  } catch (error) {
    customWarn('[IconRenderer] Error dynamically importing or rendering Lucide icons:', error);
  }
}

// Attempt to declare a global variable for the fallback scenario, mostly for type-checking the fallback.
// This doesn't guarantee it exists, but allows the check `typeof lucideReplace`.
declare var lucideReplace: any; 