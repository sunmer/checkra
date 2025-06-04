# Checkra: Instant AI-Powered UI/UX Iteration

## What is Checkra?

Checkra is a powerful, drop-in AI assistant designed to revolutionize how website owners, designers, and developers iterate on user interface (UI) and user experience (UX) ideas. It embeds directly into your live website or web application, allowing you to select any HTML element and instantly get AI-driven suggestions, modifications, or analyses for it. 

The core purpose of Checkra is to dramatically accelerate the design and development cycle. Instead of lengthy mockups, coding, and A/B testing for every minor tweak, Checkra empowers users to visualize and implement changes in real-time, leveraging advanced AI to generate creative solutions, improve existing content, or identify potential UX issues.

## High-Level Workflow

1.  **Integration**: Checkra is integrated into a website, typically as a JavaScript snippet.
2.  **Activation**: The user activates the Checkra UI (e.g., via a shortcut or a floating button).
3.  **Element Selection**: The user clicks on a specific HTML element on their page that they want to work with.
4.  **Prompting**: The user types a natural language prompt into the Checkra interface, describing what they want to achieve or analyze regarding the selected element. 
5.  **AI Processing**: The selected HTML, the user's prompt, and relevant page metadata (like brand colors, CSS framework used, etc.) are sent to the Checkra backend.
6.  **Suggestion Generation**: The AI processes this information and generates a modified version of the HTML, a new HTML snippet, or an analysis/answer.
7.  **Application & Review**: The AI's suggestion is streamed back and can be applied directly to the live page for immediate review. The user sees the change in context.
8.  **Iteration**: Users can further refine prompts, try different suggestions, or apply multiple independent fixes across their page.

## Insertion Mechanisms

When the AI generates new HTML content, Checkra offers three ways to integrate it into the page, based on the user's intent or the AI's understanding of the request:

*   **`replace`**: The AI-generated HTML completely replaces the user-selected element. This is useful for redesigning an existing component, rewriting its content, or fundamentally changing its structure.
*   **`insertBefore`**: The AI-generated HTML is inserted immediately before the user-selected element. This is ideal for adding new sections, introductory content, or elements that should precede the current one in the document flow.
*   **`insertAfter`**: The AI-generated HTML is inserted immediately after the user-selected element. This is suitable for adding supplementary information, calls to action, or sections that logically follow the selected component.

The choice of insertion mode is determined by the frontend before the request is sent to the backend, usually based on the user's explicit command (if available) or inferred from the nature of the prompt and selection.

## Example Prompts and Expected Outcomes

Users can ask a wide variety of questions or give diverse commands. Here are some examples:

*   **Content Generation/Modification:**
    *   *Prompt (selecting a paragraph)*: "Rewrite this to be more persuasive and add a call to action button that says 'Learn More'"
    *   *Expectation*: The paragraph text is updated, and a new button element is appended or integrated nearby.
    *   *Prompt (selecting a product description)*: "Make this sound more exciting and highlight the key benefits using bullet points."
    *   *Expectation*: The text is rephrased, and a bulleted list is incorporated.

*   **UI/UX Redesign & Improvement:**
    *   *Prompt (selecting a hero section)*: "Redesign this hero to be more modern and visually appealing. Use a dark theme."
    *   *Expectation*: The entire hero section's HTML is replaced with a new design, potentially altering layout, imagery, typography, and color scheme.
    *   *Prompt (selecting a form)*: "Improve the usability of this form. Maybe a two-column layout for these fields?"
    *   *Expectation*: The form's structure is modified, possibly changing field arrangements or adding UI enhancements.
    *   *Prompt (selecting a pricing table)*: "Add a 'Most Popular' badge to the middle plan and make its border blue."
    *   *Expectation*: The HTML for the specific pricing plan is updated to include a badge element and new styling.

*   **Adding New Elements/Sections:**
    *   *Prompt (selecting a section)*: "Insert a testimonial section before this."
    *   *Expectation*: A new HTML block containing a testimonial layout is generated and placed using `insertBefore`.
    *   *Prompt (selecting an article)*: "Add a related articles section after this content."
    *   *Expectation*: A new section with placeholder or AI-generated related articles is added using `insertAfter`.

*   **Analysis & Questions:**
    *   *Prompt (selecting a call-to-action button)*: "Why might this button not be converting well?"
    *   *Expectation*: The AI provides a textual analysis, possibly suggesting issues with visibility, wording, contrast, or placement, rather than direct HTML changes.
    *   *Prompt (selecting a navigation bar)*: "Is this mobile navigation accessible?"
    *   *Expectation*: The AI gives feedback on accessibility best practices related to the provided navigation HTML.

*   **Styling & Theming:**
    *   *Prompt (selecting a card component)*: "Apply a subtle shadow and rounded corners to this card, consistent with Material Design."
    *   *Expectation*: The card's HTML is updated with appropriate classes or inline styles to achieve the visual effect.

Checkra aims to understand the user's intent from natural language and apply changes intelligently, respecting the context of the selected element and the overall page structure.

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
