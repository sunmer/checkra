// ADDED: Helper function to convert rgb/rgba to hex
export function rgbToHex(rgbString: string): string | null {
  if (!rgbString || rgbString.toLowerCase() === 'transparent' || rgbString === 'rgba(0, 0, 0, 0)') {
    return null; // Treat transparent as needing a default fallback (e.g., #FFFFFF)
  }

  const match = rgbString.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/i);
  if (!match) {
    // If it doesn't match rgb/rgba, it might already be hex or a named color.
    // For simplicity, if it starts with #, assume it's hex. Otherwise, can't convert here.
    if (rgbString.startsWith('#')) return rgbString;
    return null; // Cannot convert other formats like named colors here, fallback needed
  }

  // If alpha is 0, it's effectively transparent
  if (match[4] && parseFloat(match[4]) === 0) {
    return null;
  }

  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
} 