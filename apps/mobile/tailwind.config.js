/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Nativ eingebettete Familie (app.json expo-font-Plugin): fontWeight
      // wählt auf Android automatisch die richtige Gewichts-Variante.
      // RN kennt KEINE Textvererbung — font-sans muss pro <Text> gesetzt
      // werden (Konvention: jede Text-Komponente trägt font-sans).
      fontFamily: {
        sans: ['Inter'],
      },
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
