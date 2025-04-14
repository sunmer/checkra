# Advanced Frontend Logger

A powerful, customizable frontend logging solution that makes debugging easier with enhanced visualization and source mapping.

## Features

- 🚀 **Enhanced Console Logging**: More powerful than standard console.log with rich formatting
- 🔍 **Source Viewing**: View the source code context where errors occurred
- 🔄 **Real-time Error Tracking**: Capture and display errors as they happen
- 🎨 **Customizable UI**: Fully customizable error display components
- 📊 **Content Visualization**: Smart rendering of different data types
- 🌐 **Framework Agnostic**: Works with any frontend framework (React, Vue, Angular, etc.)
- 🔧 **Easy Configuration**: Simple API with sensible defaults

## Installation

```bash
# Using npm
npm install advanced-frontend-logger

# Using yarn
yarn add advanced-frontend-logger

# Using pnpm
pnpm add advanced-frontend-logger
```

## For Developers

If you want to contribute to this project:

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm install

# Start the development server
npm run dev

# Build the library
npm run build
```

## Quick Start

```javascript
import { initLogger } from 'advanced-frontend-logger';

// Initialize with default options
const logger = initLogger();

// Start using enhanced logging
logger.log('Hello, world!');
logger.info('This is an info message');
logger.warn('This is a warning');
logger.error('This is an error', new Error('Something went wrong'));
```

## Configuration

You can customize the logger by passing options to the `initLogger` function:

```javascript
import { initLogger } from 'advanced-frontend-logger';

const logger = initLogger({
  renderErrorLogDiv: true,
  style: {
    position: 'fixed',
    bottom: '10px',
    right: '10px',
    backgroundColor: '#333',
    color: '#fff',
    maxHeight: '300px',
    zIndex: '9999'
  },
  attachToWindow: true,
  maxMessageLength: 200,
  startCollapsed: false
});
```

## API Reference

### Core Functions

#### `initLogger(options?: LoggerOptions): Logger`

Initializes and returns a logger instance with the specified options.

### Logger Interface

The logger instance provides the following methods:

- `log(message: any, ...args: any[]): void` - Standard log message
- `info(message: any, ...args: any[]): void` - Information level message
- `warn(message: any, ...args: any[]): void` - Warning level message
- `error(message: any, error?: Error, ...args: any[]): void` - Error message with optional Error object
- `group(label: string): void` - Start a grouped log
- `groupEnd(): void` - End a grouped log
- `clear(): void` - Clear the logger display

### UI Components

You can also directly use the UI components for more control:

```javascript
import { sourceViewer, contentViewer, tooltip } from 'advanced-frontend-logger';

// Example: Display source code from an error
const errorWithStack = new Error('Test error');
const sourceElement = sourceViewer.render(errorWithStack);
document.body.appendChild(sourceElement);
```

## Default Options

```javascript
const defaultOptions = {
  renderErrorLogDiv: true,
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
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
  },
  attachToWindow: true,
  maxMessageLength: 100,
  startCollapsed: true,
};
```

## Advanced Usage

### Custom Error Formatter

```javascript
import { initLogger } from 'advanced-frontend-logger';

const logger = initLogger({
  // Custom options here
});

// Create a custom error handler
window.addEventListener('error', (event) => {
  logger.error('Uncaught error:', event.error);
});

// Create a custom promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection:', new Error(event.reason));
});
```

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge).

## License

ISC