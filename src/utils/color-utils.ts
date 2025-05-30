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

export function hslToRgb({ h, s, l }: HSL): RGB {
  h /= 360; s /= 100; l /= 100;
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
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

export function generateColorScheme(primaryRgb: string, accentRgb?: string | null): string[] {
  const parsed = parseRgbString(primaryRgb);
  if (!parsed) return [];
  const primaryHsl = rgbToHsl(parsed);
  const palette: string[] = [];

  // 1. primary
  palette.push(rgbToHex(parsed));
  // 2. lighter primary
  palette.push(rgbToHex(hslToRgb(adjustLightness(primaryHsl, 15))));
  // 3. darker primary
  palette.push(rgbToHex(hslToRgb(adjustLightness(primaryHsl, -15))));
  // 4. complementary
  const comp = hslToRgb(rotateHue(primaryHsl, 180));
  palette.push(rgbToHex(comp));
  // 5. accent or triadic
  if (accentRgb) {
    const pr = parseRgbString(accentRgb);
    if (pr) palette.push(rgbToHex(pr));
  } else {
    const triad = hslToRgb(rotateHue(primaryHsl, 90));
    palette.push(rgbToHex(triad));
  }
  return palette;
} 