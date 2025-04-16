import { initCheckra } from './index';
import { CheckraAPI  } from './core';

/**
 * Set up the demonstration functionality for Checkra
 * @returns The CheckraAPI instance or null if initialization failed.
 */
export const setupDemo = (): CheckraAPI | null => {
  // Initialize Checkra for the demo
  try {
    // Example: Initialize with UI visible and get the API instance
    const checkraInstance = initCheckra({
      isVisible: true
    });

    if (checkraInstance) {
        console.log('[Checkra Demo] Initialized Checkra for demo.');
    } else {
        console.warn('[Checkra Demo] Checkra initialization returned null.');
    }
    return checkraInstance; // Return the instance

  } catch (error) {
    console.error('[Checkra Demo] Error initializing Checkra:', error);
    return null;
  }
};