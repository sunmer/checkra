/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./demo/**/*.html", // Scan HTML files in the demo folder
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('preline/plugin')
  ]
}

