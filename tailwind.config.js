/** @type {import('tailwindcss').Config} */
import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  content: [
    "./demo/**/*.html", // Scan HTML files in the demo folder
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        // Prepend 'IBM Plex Sans' to the default sans-serif stack
        sans: ['"IBM Plex Sans"', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms')
  ],
  // Force dark variants to only be applied when explicitly requested (e.g., adding 'dark' class),
  // rather than following the user's OS setting. This prevents the demo `index.html` from
  // unintentionally switching to dark mode on systems with dark preference.
  darkMode: 'class'
}

