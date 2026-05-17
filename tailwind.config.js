/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        panel: '#1a1a2e',
        toolbar: '#16213e',
        border: '#2d3748',
      },
    },
  },
  plugins: [],
};
