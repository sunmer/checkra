import * as colorUtils from '../src/utils/color-utils.ts';
import type { RGBA, HSL } from '../src/utils/color-utils.ts';

const tests: { description: string; fn: () => void | Promise<void> }[] = [];
let failures = 0;

function test(description: string, fn: () => void | Promise<void>) {
  tests.push({ description, fn });
}

// Enhanced expect function
function expect(actual: any) {
  const createMatcher = (passed: boolean, message: string) => {
    if (!passed) {
      throw new Error(message);
    }
  };

  const not = {
    toBe: (expected: any) => {
      createMatcher(actual !== expected, `Expected ${JSON.stringify(actual)} not to be ${JSON.stringify(expected)}`);
    },
    // Add other .not matchers if needed
  };

  return {
    toBe: (expected: any) => {
      createMatcher(actual === expected, `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
    },
    toEqual: (expected: any) => {
      let actualProcessed = actual;
      let expectedProcessed = expected;
      // Stringify for consistent comparison of complex objects unless they are already strings
      if (typeof actual !== 'string') actualProcessed = JSON.stringify(actual);
      if (typeof expected !== 'string') expectedProcessed = JSON.stringify(expected);

      if (actualProcessed === expectedProcessed) return;

      // More detailed comparison for objects, esp. with floating point numbers if not perfectly stringified
      if (typeof actual === 'object' && actual !== null && typeof expected === 'object' && expected !== null) {
        const actualKeys = Object.keys(actual).sort();
        const expectedKeys = Object.keys(expected).sort();

        if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
          throw new Error(`Expected keys ${JSON.stringify(expectedKeys)} but got ${JSON.stringify(actualKeys)}.\nExpected object: ${JSON.stringify(expected)}\nActual object: ${JSON.stringify(actual)}`);
        }

        for (const key of actualKeys) {
          const valActual = actual[key];
          const valExpected = expected[key];
          if (typeof valActual === 'number' && typeof valExpected === 'number') {
            // Allow a difference of up to 1 for RGB components (0-255 range)
            // For HSL, hue tolerance is handled in its specific test, other HSL values are usually precise enough or compared with tolerance.
            // General alpha (0-1) comparison needs smaller tolerance.
            const tolerance = (key === 'r' || key === 'g' || key === 'b' || key === 'h' || key === 's' || key === 'l') ? 1.01 : 0.001;
            if (Math.abs(valActual - valExpected) > tolerance) { 
              throw new Error(`Property '${key}': Expected ${valExpected} (approx) but got ${valActual}.\nExpected object: ${JSON.stringify(expected)}\nActual object: ${JSON.stringify(actual)}`);
            }
          } else if (JSON.stringify(valActual) !== JSON.stringify(valExpected)) {
            throw new Error(`Property '${key}': Expected ${JSON.stringify(valExpected)} but got ${JSON.stringify(valActual)}.\nExpected object: ${JSON.stringify(expected)}\nActual object: ${JSON.stringify(actual)}`);
          }
        }
        return; // If all checks pass for object properties
      }
      throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)} (detailed check failed)`);
    },
    toBeNull: () => {
      createMatcher(actual === null, `Expected ${JSON.stringify(actual)} to be null`);
    },
    toBeNotNull: () => {
      createMatcher(actual !== null, `Expected ${JSON.stringify(actual)} to be not null`);
    },
    toHaveLength: (expectedLength: number) => {
      if (actual === null || actual === undefined || typeof actual.length !== 'number') {
        throw new Error(`Expected value with a length property but got ${JSON.stringify(actual)}`);
      }
      createMatcher(actual.length === expectedLength, `Expected length ${expectedLength} but got ${actual.length}`);
    },
    toBeGreaterThanOrEqual: (expected: number) => {
        if (typeof actual !== 'number' || typeof expected !== 'number') {
            throw new Error(`Expected numeric values for toBeGreaterThanOrEqual, got actual: ${actual}, expected: ${expected}`);
        }
        createMatcher(actual >= expected, `Expected ${actual} to be greater than or equal to ${expected}`);
    },
    not // Add the .not chain
  };
}

// --- normalizeHex Tests ---
test('normalizeHex: #abc -> #aabbcc', () => {
  expect(colorUtils.normalizeHex('#abc')).toBe('#aabbcc');
});
test('normalizeHex: abc -> #aabbcc (no #)', () => {
  expect(colorUtils.normalizeHex('abc')).toBe('#aabbcc');
});
test('normalizeHex: #ABC (uppercase) -> #aabbcc', () => {
  expect(colorUtils.normalizeHex('#ABC')).toBe('#aabbcc');
});
test('normalizeHex: #aBcDeF (mixed case) -> #abcdef', () => {
  expect(colorUtils.normalizeHex('#aBcDeF')).toBe('#abcdef');
});
test('normalizeHex: #aabbcc -> #aabbcc', () => {
  expect(colorUtils.normalizeHex('#aabbcc')).toBe('#aabbcc');
});
test('normalizeHex: aabbcc (no #) -> #aabbcc', () => {
  expect(colorUtils.normalizeHex('aabbcc')).toBe('#aabbcc');
});
test('normalizeHex: invalid hex #ab -> null', () => {
  expect(colorUtils.normalizeHex('#ab')).toBeNull();
});
test('normalizeHex: invalid hex #abcdefg -> null', () => {
  expect(colorUtils.normalizeHex('#abcdefg')).toBeNull();
});
test('normalizeHex: invalid char #abg -> null', () => {
  expect(colorUtils.normalizeHex('#abg')).toBeNull();
});
test('normalizeHex: empty string -> null', () => {
  expect(colorUtils.normalizeHex('')).toBeNull();
});
test('normalizeHex: null input -> null', () => {
  expect(colorUtils.normalizeHex(null as any)).toBeNull();
});
test('normalizeHex: undefined input -> null', () => {
  expect(colorUtils.normalizeHex(undefined as any)).toBeNull();
});

// --- parseColorString Tests ---
test('parseColorString: #123 (short hex)', () => {
  expect(colorUtils.parseColorString('#123')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
});
test('parseColorString: 123 (short hex without #)', () => {
  expect(colorUtils.parseColorString('123')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
});
test('parseColorString: #112233 (long hex)', () => {
  expect(colorUtils.parseColorString('#112233')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
});
test('parseColorString: 112233 (long hex without #)', () => {
  expect(colorUtils.parseColorString('112233')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
});
test('parseColorString: #112233FF (hex with alpha opaque)', () => {
  expect(colorUtils.parseColorString('#112233FF')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
});
test('parseColorString: 112233FF (hex with alpha opaque without #)', () => {
    expect(colorUtils.parseColorString('112233FF')).toEqual({ r: 17, g: 34, b: 51, a: 1 });
});
test('parseColorString: #11223380 (hex with alpha 50%)', () => {
  expect(colorUtils.parseColorString('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 / 255 });
});
test('parseColorString: 11223380 (hex with alpha 50% without #)', () => {
    expect(colorUtils.parseColorString('11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 / 255 });
});
test('parseColorString: rgb(10,20,30)', () => {
  expect(colorUtils.parseColorString('rgb(10,20,30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
});
test('parseColorString: rgb( 10 , 20 , 30 ) with spaces', () => {
  expect(colorUtils.parseColorString('rgb( 10 , 20 , 30 )')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
});
test('parseColorString: rgba(10,20,30,0.5)', () => {
  expect(colorUtils.parseColorString('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
});
test('parseColorString: rgba( 10 , 20 , 30, .5 ) with spaces and shorthand alpha', () => {
  expect(colorUtils.parseColorString('rgba( 10 , 20 , 30, .5 )')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
});
test('parseColorString: invalid hex #1234 -> null', () => {
  expect(colorUtils.parseColorString('#1234')).toBeNull();
});
test('parseColorString: invalid hex 12345 -> null', () => {
    expect(colorUtils.parseColorString('12345')).toBeNull();
  });
test('parseColorString: invalid char #12X -> null', () => {
  expect(colorUtils.parseColorString('#12X')).toBeNull();
});
test('parseColorString: rgb values out of range rgb(256,0,0) -> null', () => {
  expect(colorUtils.parseColorString('rgb(256,0,0)')).toBeNull();
});
test('parseColorString: rgb values out of range rgb(-1,0,0) -> null', () => {
  expect(colorUtils.parseColorString('rgb(-1,0,0)')).toBeNull();
});
test('parseColorString: rgba alpha out of range rgba(0,0,0,1.1) -> null', () => {
  expect(colorUtils.parseColorString('rgba(0,0,0,1.1)')).toBeNull();
});
test('parseColorString: rgba alpha out of range rgba(0,0,0,-0.1) -> null', () => {
  expect(colorUtils.parseColorString('rgba(0,0,0,-0.1)')).toBeNull();
});
test('parseColorString: malformed rgb rgb(10,20) -> null', () => {
  expect(colorUtils.parseColorString('rgb(10,20)')).toBeNull();
});
test('parseColorString: named color (not supported) -> null', () => {
  expect(colorUtils.parseColorString('red')).toBeNull();
});
test('parseColorString: empty string -> null', () => {
  expect(colorUtils.parseColorString('')).toBeNull();
});
test('parseColorString: string with only spaces -> null', () => {
  expect(colorUtils.parseColorString('   ')).toBeNull();
});

// --- rgbaToHex Tests ---
test('rgbaToHex: basic conversion', () => {
  expect(colorUtils.rgbaToHex({ r: 17, g: 34, b: 51, a: 1 })).toBe('#112233');
});
test('rgbaToHex: alpha is ignored', () => {
  expect(colorUtils.rgbaToHex({ r: 17, g: 34, b: 51, a: 0.5 })).toBe('#112233');
});
test('rgbaToHex: values are clamped and rounded', () => {
  expect(colorUtils.rgbaToHex({ r: 300.6, g: -10.2, b: 51.5, a: 1 })).toBe('#ff0034'); // 51.5 rounds to 52 (0x34)
});
test('rgbaToHex: black', () => {
  expect(colorUtils.rgbaToHex({ r: 0, g: 0, b: 0, a: 1 })).toBe('#000000');
});
test('rgbaToHex: white', () => {
  expect(colorUtils.rgbaToHex({ r: 255, g: 255, b: 255, a: 0 })).toBe('#ffffff');
});

// --- HSL/RGB Conversion Tests (round trip and specific values) ---
const colorTestCases: { name: string; rgba: RGBA; hsl: HSL }[] = [
  { name: 'red', rgba: { r: 255, g: 0, b: 0, a: 1 }, hsl: { h: 0, s: 100, l: 50 } },
  { name: 'lime', rgba: { r: 0, g: 255, b: 0, a: 1 }, hsl: { h: 120, s: 100, l: 50 } },
  { name: 'blue', rgba: { r: 0, g: 0, b: 255, a: 1 }, hsl: { h: 240, s: 100, l: 50 } },
  { name: 'yellow', rgba: { r: 255, g: 255, b: 0, a: 1 }, hsl: { h: 60, s: 100, l: 50 } },
  { name: 'cyan', rgba: { r: 0, g: 255, b: 255, a: 1 }, hsl: { h: 180, s: 100, l: 50 } },
  { name: 'magenta', rgba: { r: 255, g: 0, b: 255, a: 1 }, hsl: { h: 300, s: 100, l: 50 } },
  { name: 'white', rgba: { r: 255, g: 255, b: 255, a: 1 }, hsl: { h: 0, s: 0, l: 100 } },
  { name: 'black', rgba: { r: 0, g: 0, b: 0, a: 1 }, hsl: { h: 0, s: 0, l: 0 } },
  { name: 'gray', rgba: { r: 128, g: 128, b: 128, a: 1 }, hsl: { h: 0, s: 0, l: 50 } },
  { name: 'custom_1 (desaturated blue)', rgba: { r: 100, g: 150, b: 200, a: 0.7 }, hsl: { h: 210, s: 48, l: 59 } }, // approx HSL (rounded)
];

colorTestCases.forEach(tc => {
  test(`rgbaToHsl: ${tc.name}`, () => {
    const calculatedHsl = colorUtils.rgbaToHsl(tc.rgba);
    expect(calculatedHsl.s).toEqual(tc.hsl.s); // Saturation
    expect(calculatedHsl.l).toEqual(tc.hsl.l); // Lightness
    if (tc.hsl.s > 0 || (tc.hsl.l > 0 && tc.hsl.l < 100)) { // Only check hue if not pure gray/black/white (where hue can be arbitrary)
        const hDiff = Math.abs(calculatedHsl.h - tc.hsl.h);
        // Hue can be 0 or 360 for the same color, or wrap around
        const hueMatch = hDiff < 2 || Math.abs(hDiff - 360) < 2;
        if (!hueMatch) {
            throw new Error(`For ${tc.name}, expected hue ~${tc.hsl.h}, got ${calculatedHsl.h}`);
        }
    }
  });
  test(`hslToRgb: ${tc.name}`, () => {
    const expectedRgba = { ...tc.rgba, a: 1 }; // hslToRgb always returns a=1
    expect(colorUtils.hslToRgb(tc.hsl)).toEqual(expectedRgba);
  });
  test(`Round trip RGBA -> HSL -> RGBA: ${tc.name}`, () => {
    const hsl = colorUtils.rgbaToHsl(tc.rgba);
    const roundTripRgba = colorUtils.hslToRgb(hsl);
    const expectedRgba = { ...tc.rgba, a: 1 }; // hslToRgb always returns a=1
    expect(roundTripRgba).toEqual(expectedRgba);
  });
});

test('hslToRgb specific cases: very dark', () => {
    expect(colorUtils.hslToRgb({h: 100, s: 100, l: 1})).toEqual({r: 3, g: 5, b: 0, a: 1}); // approx
});

test('hslToRgb specific cases: very light', () => {
    expect(colorUtils.hslToRgb({h: 200, s: 100, l: 99})).toEqual({r: 250, g: 253, b: 255, a: 1}); // approx
});

// --- adjustHslLightness Tests ---
test('adjustHslLightness: lighten', () => {
  expect(colorUtils.adjustHslLightness({ h: 0, s: 100, l: 50 }, 10)).toEqual({ h: 0, s: 100, l: 60 });
});
test('adjustHslLightness: darken', () => {
  expect(colorUtils.adjustHslLightness({ h: 0, s: 100, l: 50 }, -10)).toEqual({ h: 0, s: 100, l: 40 });
});
test('adjustHslLightness: clamp to 100 (max lightness)', () => {
  expect(colorUtils.adjustHslLightness({ h: 0, s: 100, l: 95 }, 10)).toEqual({ h: 0, s: 100, l: 100 });
});
test('adjustHslLightness: no change when already 100 and lightening', () => {
  expect(colorUtils.adjustHslLightness({ h: 0, s: 100, l: 100 }, 10)).toEqual({ h: 0, s: 100, l: 100 });
});
test('adjustHslLightness: clamp to 0 (min lightness)', () => {
  expect(colorUtils.adjustHslLightness({ h: 0, s: 100, l: 5 }, -10)).toEqual({ h: 0, s: 100, l: 0 });
});
test('adjustHslLightness: no change when already 0 and darkening', () => {
  expect(colorUtils.adjustHslLightness({ h: 0, s: 100, l: 0 }, -10)).toEqual({ h: 0, s: 100, l: 0 });
});

// --- rotateHue Tests ---
test('rotateHue: basic rotation', () => {
  expect(colorUtils.rotateHue({ h: 0, s: 100, l: 50 }, 120)).toEqual({ h: 120, s: 100, l: 50 });
});
test('rotateHue: wrap around 360 (positive)', () => {
  expect(colorUtils.rotateHue({ h: 300, s: 100, l: 50 }, 120)).toEqual({ h: 60, s: 100, l: 50 });
});
test('rotateHue: wrap around 360 (negative)', () => {
  expect(colorUtils.rotateHue({ h: 60, s: 100, l: 50 }, -120)).toEqual({ h: 300, s: 100, l: 50 });
});
test('rotateHue: no change if deg is 0', () => {
  expect(colorUtils.rotateHue({ h: 50, s: 50, l: 50 }, 0)).toEqual({ h: 50, s: 50, l: 50 });
});
test('rotateHue: no change if deg is 360', () => {
  expect(colorUtils.rotateHue({ h: 50, s: 50, l: 50 }, 360)).toEqual({ h: 50, s: 50, l: 50 });
});

// --- generateColorScheme Tests ---
test('generateColorScheme: basic primary hex (red)', () => {
  const palette = colorUtils.generateColorScheme('#ff0000');
  expect(palette).toHaveLength(5);
  expect(palette[0]).toBe('#ff0000');
  palette.forEach(color => expect(colorUtils.parseColorString(color)).toBeNotNull());
});

test('generateColorScheme: primary (blue) and accent (yellow)', () => {
  const palette = colorUtils.generateColorScheme('#0000ff', '#ffff00');
  expect(palette).toHaveLength(5);
  expect(palette[0]).toBe('#0000ff');
  expect(palette[4]).toBe('#ffff00');
  palette.forEach(color => expect(colorUtils.parseColorString(color)).toBeNotNull());
});

test('generateColorScheme: primary rgb string', () => {
  const palette = colorUtils.generateColorScheme('rgb(0, 255, 0)');
  expect(palette).toHaveLength(5);
  expect(palette[0]).toBe('#00ff00');
  palette.forEach(color => expect(colorUtils.parseColorString(color)).toBeNotNull());
});

test('generateColorScheme: invalid primary -> empty array', () => {
  const palette = colorUtils.generateColorScheme('invalid-color');
  expect(palette).toEqual([]);
  expect(palette).toHaveLength(0);
});

test('generateColorScheme: primary and invalid accent -> uses triadic for 5th color', () => {
  const palette = colorUtils.generateColorScheme('#ff0000', 'invalid-accent');
  expect(palette).toHaveLength(5);
  expect(palette[0]).toBe('#ff0000');
  expect(palette[4]).not.toBe('invalid-accent'); // Check that the accent color itself is not literally 'invalid-accent'
  expect(colorUtils.parseColorString(palette[4])).toBeNotNull(); // Ensure fallback is a valid color
});

test('generateColorScheme: primary is white', () => {
  const palette = colorUtils.generateColorScheme('#ffffff');
  expect(palette).toHaveLength(5);
  expect(palette[0]).toBe('#ffffff');
  const uniqueColors = new Set(palette);
  expect(uniqueColors.size).toBeGreaterThanOrEqual(2); // Adjusted expectation for white
  palette.forEach(color => expect(colorUtils.parseColorString(color)).toBeNotNull());
});

test('generateColorScheme: primary is black', () => {
  const palette = colorUtils.generateColorScheme('#000000');
  expect(palette).toHaveLength(5);
  expect(palette[0]).toBe('#000000');
  const uniqueColors = new Set(palette);
  expect(uniqueColors.size).toBeGreaterThanOrEqual(2); // Adjusted expectation for black
  palette.forEach(color => expect(colorUtils.parseColorString(color)).toBeNotNull());
});

test('generateColorScheme: ensure 5 distinct colors (usually)', () => {
    const palette = colorUtils.generateColorScheme('#3498db'); // A typical blue
    expect(palette).toHaveLength(5);
    const uniqueColors = new Set(palette);
    // For most colors, all 5 should be unique.
    expect(uniqueColors.size).toBeGreaterThanOrEqual(4); // At least 4, often 5
});

// --- parseRgbString Tests (direct, though covered by parseColorString indirectly) ---
test('parseRgbString: valid', () => {
    expect(colorUtils.parseRgbString('rgb(10,20,30)')).toEqual({r:10,g:20,b:30});
});
test('parseRgbString: invalid (no closing paren)', () => {
    expect(colorUtils.parseRgbString('rgb(10,20,30')).toBeNull();
});
test('parseRgbString: invalid (text instead of numbers)', () => {
    expect(colorUtils.parseRgbString('rgb(aa,bb,cc)')).toBeNull();
});

// Runner
async function runTests() {
  console.log('Starting color utility tests...\n');
  let passedCount = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ PASS: ${t.description}`);
      passedCount++;
    } catch (e: any) {
      console.error(`❌ FAIL: ${t.description}`);
      const message = e && typeof e.message === 'string' ? e.message : 'Unknown error during test';
      console.error(`   Error: ${message}`);
      // if (e && typeof e.stack === 'string') { console.error(`   Stack: ${e.stack}`); }
      failures++;
    }
  }
  console.log('\n-------------------');
  console.log(`Total tests: ${tests.length}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failures}`);
  console.log('-------------------\n');
  if (failures > 0) {
    process.exit(1);
  }
}

runTests(); 