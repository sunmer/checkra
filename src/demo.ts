// @ts-nocheck
import { initLogger } from './index';

/**
 * Set up the demonstration functionality for Console.ai
 */
export const setupDemo = () => {
  // Initialize logger
  try {
    initLogger({
      renderErrorLogDiv: true,
      startCollapsed: true
    });

    // Set up button event listeners
    setupButtonListeners();

  } catch (error) {
    console.error(error);
  }
};

const setupButtonListeners = () => {
  // Existing button listeners...
  document.getElementById('warn-btn')?.addEventListener('click', handleWarnClick);
  document.getElementById('error-btn')?.addEventListener('click', handleErrorClick);
  document.getElementById('reference-error-btn')?.addEventListener('click', handleReferenceErrorClick);
  document.getElementById('type-error-btn')?.addEventListener('click', handleTypeErrorClick);
  document.getElementById('syntax-error-btn')?.addEventListener('click', handleSyntaxErrorClick);
  document.getElementById('range-error-btn')?.addEventListener('click', handleRangeErrorClick);
  document.getElementById('group-btn')?.addEventListener('click', handleGroupClick);
  document.getElementById('groupEnd-btn')?.addEventListener('click', handleGroupEndClick);
  document.getElementById('nested-error-btn')?.addEventListener('click', handleNestedErrorClick);

  // New configuration error button listeners
  document.getElementById('env-config-error-btn')?.addEventListener('click', handleEnvConfigErrorClick);
  document.getElementById('cors-config-error-btn')?.addEventListener('click', handleCorsConfigErrorClick);
  document.getElementById('csp-error-btn')?.addEventListener('click', handleCspErrorClick);
};

/**
 * Handler for the warning button click
 */
const handleWarnClick = () => {
  // Warning from using a deprecated method
  const obj = {};
  Object.defineProperty(obj, 'prop', {
    get: function () {
      console.warn('Property "prop" is deprecated and will be removed in future versions');
      return 'deprecated value';
    }
  });
  const value = obj.prop;
  console.log('Retrieved value:', value);
};

/**
 * Handler for the error button click
 */const handleErrorClick = () => {const user = null;try {if (user) {console.log(user.name);} else {console.log("User is null, cannot access properties.");}} catch (error) {console.error("Failed to access user data:", error);}};










/**
 * Handler for the reference error button click
 */
const handleReferenceErrorClick = () => {
  // ReferenceError: trying to access an undefined variable
  try {
    console.log(undefinedVariable); // Variable doesn't exist
  } catch (error) {
    console.error('Reference error caught:', error);
  }
};

/**
 * Handler for the type error button click
 */const handleTypeErrorClick = () => {try {const num = 42;const upperCaseString = String(num).toUpperCase(); // Convert num to string and then to uppercase
    console.log(upperCaseString); // This will log "42" as uppercase (remains "42" since it's a number)
  } catch (error) {console.error("Type error caught:", error);}};








/**
 * Handler for the syntax error button click
 */
const handleSyntaxErrorClick = () => {
  // SyntaxError: using eval with invalid syntax
  try {
    eval('if (true) { console.log("Missing closing brace"');
  } catch (error) {
    console.error('Syntax error caught:', error);
  }
};

/**
 * Handler for the range error button click
 */
const handleRangeErrorClick = () => {
  // RangeError: invalid array length
  try {
    const arr = new Array(-1); // Negative array length is invalid
  } catch (error) {
    console.error('Range error caught:', error);
  }
};

/**
 * Handler for the group button click
 */
const handleGroupClick = () => {
  console.group('Error Group');
  try {
    // Nested error in a group
    const obj = {};
    obj.nonExistentMethod();
  } catch (error) {
    console.error('Error in group:', error);
  }
  console.log('Additional context information');
};

/**
 * Handler for the group end button click
 */
const handleGroupEndClick = () => {
  console.groupEnd();
};

/**
 * Handler for the nested error button click
 * This function calls another valid function
 */
const handleNestedErrorClick = () => {
  console.log('Initiating nested error sequence...');
  try {
    // Call first level function (valid)
    performFirstLevelOperation();
  } catch (error) {
    console.error('Caught error from nested function call:', error);
  }
};

/**
 * First level function that will be called by handleNestedErrorClick
 * This function executes normally and calls another valid function
 */
const performFirstLevelOperation = () => {
  console.log('Inside first level operation - executing normally');
  // Call the second level function (also valid)
  performSecondLevelOperation();
};

/**
 * Second level function that will be called by performFirstLevelOperation
 * This function executes normally and calls another valid function
 */
const performSecondLevelOperation = () => {
  console.log('Inside second level operation - everything still working fine');
  // Call the third level function (also valid)
  performThirdLevelOperation();
};

/**
 * Third level function that will be called by performSecondLevelOperation
 * This function executes normally but then calls a non-existent function
 */
const performThirdLevelOperation = () => {
  console.log('Nested error example - about to call non-existent function');
  // Call a non-existent function - this will cause a ReferenceError
  nonExistentFunction();
};

/**
 * Handler for the environment variable configuration error button click
 */
const handleEnvConfigErrorClick = () => {
  console.log('Checking for required environment variables...');
  try {
    // Simulate accessing an undefined environment variable
    // In a real app, this would be something like process.env.API_KEY or import.meta.env.VITE_API_URL
    const apiUrl = window.__ENV__ && window.__ENV__.API_URL;

    if (!apiUrl) {
      throw new Error('Environment configuration error: Required environment variable API_URL is not defined. Check your .env file and build configuration.');
    }

    // Try to use the API URL, which will fail
    fetch(apiUrl + '/data').
    then((response) => response.json()).
    catch((err) => {
      console.error('Failed to fetch data:', err);
    });
  } catch (error) {
    console.error('Environment configuration error:', error);
  }
};

/**
  * Handler for the CORS configuration error button click
  */
const handleCorsConfigErrorClick = () => {
  console.log('Attempting to fetch data from a misconfigured API endpoint...');

  // Create a URL that will trigger a CORS error
  // This simulates a common frontend configuration issue where CORS is not properly set up
  const apiUrl = 'https://example.com/api/data';

  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ test: 'data' })
  }).
  then((response) => response.json()).
  catch((error) => {
    console.error('CORS configuration error:', error);
    console.error('This error indicates a CORS configuration issue. The server needs to include appropriate Access-Control-Allow-Origin headers.');
  });
};

/**
* Handler for the CSP (Content Security Policy) error button click
*/
const handleCspErrorClick = () => {
  console.log('Attempting to execute dynamically created inline script...');

  try {
    // Create a script element dynamically (this would be blocked by CSP with default-src 'self')
    const scriptElement = document.createElement('script');
    scriptElement.textContent = 'console.log("This script execution would be blocked by CSP")';
    document.body.appendChild(scriptElement);

    // Also try to load an external script (would be blocked by CSP if not allowed)
    const externalScript = document.createElement('script');
    externalScript.src = 'https://cdn.example.com/script.js';
    externalScript.onerror = (e) => {
      console.error('Content Security Policy error: Failed to load external script:', e);
      console.error('This indicates a CSP configuration issue. Your Content-Security-Policy needs to allow this script source.');
    };
    document.body.appendChild(externalScript);
  } catch (error) {
    console.error('Content Security Policy error:', error);
  }
};

// Deprecated legacy export that was mentioned in the original file
export const demo = () => {};