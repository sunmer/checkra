import { LoggerOptions } from './types';

/**
 * Default configuration options for the logger.
 */
export const defaultOptions: LoggerOptions = {
  renderErrorLogDiv: true,
  errorLogDivId: 'error-log',
  style: {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    color: 'white',
    fontSize: '12px',
    maxHeight: '200px',
    overflowY: 'auto',
    zIndex: '1000',
    padding: '20px 30px',
    fontFamily: 'monospace'
  },
  attachToWindow: true,
  maxMessageLength: 100,
  startCollapsed: true,
};