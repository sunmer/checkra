import { UiKitDetection } from "@/types";

/**
 * Heuristic UI-kit detector.  Looks for attribute/class fingerprints.
 * Currently recognises Flowbite (Tailwind), Preline (Tailwind) and Bootstrap-JS helpers.
 */
export function detectUiKit(html: string): UiKitDetection {
  if (!html) return { name: null, confidence: null };
  const lower = html.toLowerCase();

  type KitSig = { name: string; patterns: RegExp[] };

  const signatures: KitSig[] = [
    {
      name: 'flowbite',
      patterns: [/data-modal-toggle=/, /data-tooltip-target=/, /flowbite/i]
    },
    {
      name: 'preline',
      patterns: [/class="[^"]*hs-/, /data-hs-/]
    },
    {
      name: 'daisyui',
      // DaisyUI uses global classes like btn, card, alert but to reduce false positives look for a combo with daisy specific variables.
      patterns: [/class="[^"]*(btn|card|alert)[^"]*"/, /data-theme=/]
    },
    {
      name: 'shadcn',
      // Shadcn/ui leverages Radix primitives – look for data-state attributes plus shadcn classes (e.g., bg-background).
      patterns: [/data-state=/, /bg-background|text-foreground/]
    },
    {
      name: 'chakra-ui',
      patterns: [/data-testid="chakra-/, /--chakra-colors-/, /class="[^"]*chakra-/]
    },
    {
      name: 'mui',
      patterns: [/class="[^"]*mui[a-z0-9-]*-/i, /class="[^"]*Mui[A-Z]/]
    },
    {
      name: 'bootstrap',
      patterns: [/data-bs-toggle=/, /data-bs-dismiss=/, /data-bs-target=/]
    }
  ];

  let best: UiKitDetection = { name: null, confidence: 0 };

  signatures.forEach(sig => {
    const hits = sig.patterns.filter(p => p.test(lower)).length;
    if (hits > 0) {
      const confidence = Math.min(1, hits / sig.patterns.length);
      if (confidence > (best.confidence ?? 0)) {
        best = { name: sig.name, confidence };
      }
    }
  });

  if (!best.name) return { name: null, confidence: null };
  return best;
}