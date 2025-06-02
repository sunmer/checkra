# Checkra Product Requirements - Applied Fix Controls UX

## Core User Experience for Applied Fix Controls

1.  **Persistence**: When an AI suggestion (a "fix") is applied to an element on the page, a set of control buttons (e.g., toggle original/fixed, copy prompt, close/revert fix, rate fix) should appear in relation to that specific modified element.
2.  **Individual Association**: Each applied fix on the page will have its own dedicated instance of these controls. If multiple fixes are applied to different elements, multiple sets of controls will be visible simultaneously, each associated with its respective fix.
3.  **Constant Visibility (Near Fix)**: The controls for an applied fix should remain visible and positioned near their associated fixed element as the user scrolls the page. They are not global controls that appear/disappear for all fixes at once, nor do they only show on hover (unless that's a separate, secondary interaction for de-cluttering, but the primary state is visible).
4.  **Functionality**: Each set of controls operates *only* on the fix it is visually associated with.
    *   **Toggle**: Swaps the content of its associated fix between the original and AI-generated versions.
    *   **Copy**: Copies information related to its specific fix.
    *   **Close/Revert**: Reverts its specific fix back to the original content and removes the controls for that fix.
    *   **Rate**: Allows rating of its specific fix.

## Underlying Principle

The goal is to allow users to manage and interact with multiple, independent AI-generated modifications on their page simultaneously, with clear, persistent visual controls for each modification.
