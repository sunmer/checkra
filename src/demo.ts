// @ts-nocheck
import { initLogger } from './index';

/**
 * Set up the demonstration functionality for Checkra
 */
export const setupDemo = () => {
  // Initialize logger
  try {
    initLogger({
      renderErrorLogDiv: true
    });
  } catch (error) {
    console.error(error);
  }
};
// Deprecated legacy export that was mentioned in the original file
export const demo = () => { };