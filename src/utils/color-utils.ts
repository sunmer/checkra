export interface RGB { r: number; g: number; b: number; }
export interface HSL { h: number; s: number; l: number; }

export function parseRgbString(input: string): RGB | null {
  const m = input.match(/rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb(hsl: HSL): RGBA {
  let { h, s, l } = hsl;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
    a: 1,
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function adjustLightness(hsl: HSL, delta: number): HSL {
  return { ...hsl, l: Math.max(0, Math.min(100, hsl.l + delta)) };
}

export function rotateHue(hsl: HSL, deg: number): HSL {
  let h = (hsl.h + deg) % 360;
  if (h < 0) h += 360;
  return { ...hsl, h };
}

export function generateColorScheme(primaryColorStr: string, accentColorStr?: string | null): string[] {
  const primaryRgba = parseColorString(primaryColorStr);
  if (!primaryRgba) return [];

  const primaryHsl = rgbaToHsl(primaryRgba);
  const palette: string[] = [];

  // 1. primary
  palette.push(rgbaToHex(primaryRgba));
  // 2. lighter primary
  palette.push(rgbaToHex(hslToRgb(adjustHslLightness(primaryHsl, 15))));
  // 3. darker primary
  palette.push(rgbaToHex(hslToRgb(adjustHslLightness(primaryHsl, -15))));
  
  // 4. complementary
  const compHsl = rotateHue(primaryHsl, 180);
  palette.push(rgbaToHex(hslToRgb(compHsl)));
  
  // 5. accent or triadic
  if (accentColorStr) {
    const accentRgba = parseColorString(accentColorStr);
    if (accentRgba) {
      palette.push(rgbaToHex(accentRgba));
    } else { // Fallback if accent parsing fails
      const triadHsl = rotateHue(primaryHsl, 120); // Use a triadic color as a fallback accent
      palette.push(rgbaToHex(hslToRgb(triadHsl)));
    }
  } else {
    const triadHsl = rotateHue(primaryHsl, 120); // Default to triadic if no accent provided
    palette.push(rgbaToHex(hslToRgb(triadHsl)));
  }
  
  // Ensure palette has 5 colors, if accent was invalid or missing and we used triadic,
  // we might need one more. For simplicity, let's assume the logic above gets 5.
  // If accent parsing failed and we used a triad, we're at 5.
  // If no accent provided, we used a triad, we're at 5.
  // This logic should be fine for 5 distinct colors.

  return palette.slice(0, 5); // Ensure it's exactly 5
}

/**
 * Represents an RGBA color.
 */
export interface RGBA extends RGB { a: number; }

/**
 * Normalizes a hex color string to a 6-digit format with a leading #.
 * Handles 3-digit hex, 6-digit hex. Returns null for invalid format.
 * @param hex The hex string.
 * @returns Normalized hex string (e.g., "#RRGGBB") or null.
 */
export function normalizeHex(hex: string): string | null {
  if (!hex) return null;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]+$/.test(h)) return null; // Invalid characters

  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length === 6) {
    return `#${h.toLowerCase()}`;
  }
  // Could add support for 8-digit hex if alpha is needed, but for now, focus on 6.
  return null; 
}

/**
 * Parses a color string (hex, rgb, rgba) into an RGBA object.
 * @param colorString The color string to parse.
 * @returns An RGBA object {r, g, b, a} or null if parsing fails. Alpha is 0-1.
 */
export function parseColorString(colorString: string | null | undefined): RGBA | null {
  if (!colorString || typeof colorString !== 'string') {
    return null;
  }

  const s = colorString.trim().toLowerCase();

  // Try to parse as hex (3, 6, or 8 digits)
  // Allow hex strings without a leading '#'
  const hexRegex = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const hexMatch = s.match(hexRegex);

  if (hexMatch) {
    let hexVal = hexMatch[1];
    if (!/^[0-9a-fA-F]+$/.test(hexVal)) return null; // Double check characters

    if (hexVal.length === 3) {
      hexVal = hexVal[0] + hexVal[0] + hexVal[1] + hexVal[1] + hexVal[2] + hexVal[2];
    }
    // For 6-digit hex (becomes 8 with ff alpha)
    if (hexVal.length === 6) {
      const bigint = parseInt(hexVal, 16);
      return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255,
        a: 1,
      };
    }
    // For 8-digit hex (includes alpha)
    if (hexVal.length === 8) {
      const bigint = parseInt(hexVal, 16);
      return {
        r: (bigint >> 24) & 255,
        g: (bigint >> 16) & 255,
        b: (bigint >> 8) & 255,
        a: (bigint & 255) / 255,
      };
    }
    return null; // Should not be reached if regex is correct
  }

  // Try to parse as rgb() or rgba()
  const rgbMatch = s.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d\.]+)\s*)?\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;

    if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255 && a >= 0 && a <= 1) {
      return { r, g, b, a };
    }
    return null; // Values out of range
  }

  return null; // Unknown format
}

/**
 * Converts an RGBA object to a hex string (#RRGGBB). Alpha is ignored.
 * @param rgba The RGBA object.
 * @returns Hex string.
 */
export function rgbaToHex(rgba: RGBA): string {
  const r = Math.min(255, Math.max(0, Math.round(rgba.r))).toString(16).padStart(2, '0');
  const g = Math.min(255, Math.max(0, Math.round(rgba.g))).toString(16).padStart(2, '0');
  const b = Math.min(255, Math.max(0, Math.round(rgba.b))).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Converts an RGBA object to an HSL object.
 * @param rgba The RGBA object.
 * @returns HSL object. Alpha is ignored from input but can be carried over if needed.
 */
export function rgbaToHsl(rgba: RGBA): HSL {
    const r = rgba.r / 255;
    const g = rgba.g / 255;
    const b = rgba.b / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
}

// Refactor adjustLightness to work with HSL
export function adjustHslLightness(hsl: HSL, amount: number): HSL {
  return {
    h: hsl.h,
    s: hsl.s,
    l: Math.max(0, Math.min(100, hsl.l + amount)),
  };
} 