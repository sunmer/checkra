# Colour & Token Extraction Pipeline

This document explains how the browser-side code decides **where** to pull design tokens from and **why**.

## 1.  Detect the Stack

`utils/framework-detector.ts` now returns:

* `utilityDensity`  – percentage of class-names that look like Tailwind/Uno utilities.
* `type`            – `'utility-first' | 'component-based' | 'unknown'`.

Those hints allow the extractor to take the cheapest accurate path.

## 2.  Extraction Branches

| Branch | Trigger | Method | Tokens Captured |
|--------|---------|--------|-----------------|
| **A**  | `utilityDensity ≥ 0.3` | Regex over class lists | colours (`text-*`, `bg-*`), spacing, depth, motion |
| **B**  | Component frameworks | `getComputedStyle(el).getPropertyValue('--bs-primary')` | brand CSS variables |
| **C**  | Fallback | Bubble `getComputedStyle` up ancestor chain | cascaded `color` + `background-color` |
| **D**  | Last-resort | `html2canvas` + 32-step RGB bucketing | dominant + accent colours |

All paths converge via `ensureContrast()` which bumps lightness until WCAG AA is met.

## 3.  Data sent to the backend

```
metadata.brand.inferred = {
  primary: 'rgb(12,34,56)',
  accent:  'rgb(200,210,220)',
  source:  'computed',     // A | B | C | D
  contrastRatio: 5.8,
  wasLightnessTweaked: false
}

metadata.perfHints = {
  branch: 'C',  // which extractor fired
  ms: 4.3       // time spent in ms (plus canvasMs for branch D)
}

metadata.leverValues = {
  spacingStep: 'space-y-6',
  depthPreset: 'shadow-lg',
  motionPreset: 'duration-300'
}
```

These fields let the LLM "skin" canonical components with the site's own rhythm & palette, while also giving us telemetry about slow paths.

## 4.  Security

Before any selected HTML is marshalled, `<script>` tags are stripped to prevent echoing executable code back through the LLM.

---

**Why not rely solely on `html2canvas`?**  Because 95 % of the time branches A–C give deterministic tokens in < 5 ms.  The screenshot path costs hundreds of ms and risks CORS failures, so we hit it only when everything else fails. 