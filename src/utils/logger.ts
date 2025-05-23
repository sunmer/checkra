// Vite sets process.env.NODE_ENV during build, or it might be set by the server environment.
// For library mode, 'production' is typical. For dev server, it's 'development'.
const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Custom logger that only outputs in development mode.
 */
export const customLog = (...args: any[]): void => {
  if (IS_DEV) {
    console.log(...args);
  }
};

/**
 * Custom warning logger that only outputs in development mode.
 */
export const customWarn = (...args: any[]): void => {
  if (IS_DEV) {
    console.warn(...args);
  }
};

/**
 * Custom error logger.
 * In development, it logs to console.error.
 * In production, it currently also logs to console.error, 
 * but could be configured to send errors to a monitoring service.
 */
export const customError = (...args: any[]): void => {
  // Optionally, always log errors, or make it conditional like others
  // if (IS_DEV) { 
  console.error(...args);
  // } else {
  //   // In production, you might send to a service like Sentry
  //   // For now, let's also log to console or make it silent based on stricter prod policy
  //   console.error(...args); 
  // }
}; 