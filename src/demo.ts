import { initLogger } from '../src/index';

// Initialize the logger
initLogger({
  renderErrorLogDiv: true,
  startCollapsed: false,
});

// Add event listeners to test buttons
document.getElementById('log-btn')?.addEventListener('click', () => {
  console.log('This is a test log message', { data: 'some test data' });
});

document.getElementById('error-btn')?.addEventListener('click', () => {
  console.error('This is a test error message', new Error('Test error'));
});

// Log on page load
console.info('Logger demo initialized');