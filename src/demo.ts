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

/**
 * Set up all button event listeners for the demo
 */
const setupButtonListeners = () => {
  document.getElementById('warn-btn')?.addEventListener('click', handleWarnClick);
  document.getElementById('error-btn')?.addEventListener('click', handleErrorClick);
  document.getElementById('reference-error-btn')?.addEventListener('click', handleReferenceErrorClick);
  document.getElementById('type-error-btn')?.addEventListener('click', handleTypeErrorClick);
  document.getElementById('syntax-error-btn')?.addEventListener('click', handleSyntaxErrorClick);
  document.getElementById('range-error-btn')?.addEventListener('click', handleRangeErrorClick);
  document.getElementById('group-btn')?.addEventListener('click', handleGroupClick);
  document.getElementById('groupEnd-btn')?.addEventListener('click', handleGroupEndClick);
  document.getElementById('nested-error-btn')?.addEventListener('click', handleNestedErrorClick);
};

/**
 * Handler for the warning button click
 */const handleWarnClick = () => {const obj = { newProp: "non-deprecated value" // Use a new property name
  };const value = obj.newProp; // Access the new property
  console.log("Retrieved value:", value);};











/**
 * Handler for the error button click
 */
const handleErrorClick = () => {
  // Error from trying to access a property on null
  const user = null;
  try {
    console.log(user.name); // This will throw an error
  } catch (error) {
    console.error('Failed to access user data:', error);
  }
};

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
 */
const handleTypeErrorClick = () => {
  // TypeError: calling a method on the wrong type
  try {
    const num = 42;
    num.toUpperCase(); // Numbers don't have toUpperCase method
  } catch (error) {
    console.error('Type error caught:', error);
  }
};

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

// Deprecated legacy export that was mentioned in the original file
export const demo = () => {};