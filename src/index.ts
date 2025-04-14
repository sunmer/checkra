// Export types
export type { LoggerOptions, Logger, ErrorInfo } from './types';

// Export main functionality
export { initLogger } from './core/logger';

// Export UI components for direct access if needed
export { sourceViewer } from './ui/source-viewer';
export { codeFixViewer } from './ui/code-fix-viewer';
export { tooltip } from './ui/tooltip';