/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: '#131313',
        'surface-container': '#1e1e1e',
        'surface-container-high': '#2c2c2c',
        primary: '#b4ff39',
        'primary-dim': '#93db00',
        'on-primary': '#213600',
        'on-surface': '#e5e2e1',
        'on-surface-muted': '#a0a0a0',
        outline: '#424a35',
        error: '#ffb4ab',
      },
    },
  },
  plugins: [],
};
