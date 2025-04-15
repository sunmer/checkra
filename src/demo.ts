import { initCheckra } from './index';

/**
 * Set up the demonstration functionality for Checkra
 */
export const setupDemo = () => {
  // Initialize Checkra for the demo
  try {
    // Example: Initialize with UI visible
    initCheckra({
      isVisible: true
    });
    console.log('[Checkra Demo] Initialized Checkra for demo.');

  } catch (error) {
    console.error('[Checkra Demo] Error initializing Checkra:', error);
  }
};

// Deprecated legacy export (can likely be removed if not used)
export const demo = () => { };