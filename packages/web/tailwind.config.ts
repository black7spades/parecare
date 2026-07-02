import type { Config } from 'tailwindcss';

// Colors come from CSS variables (see index.css) so the dark theme can
// swap the palette without touching component classes.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: v('--c-primary'),
          50: v('--c-primary-50'),
          100: v('--c-primary-100'),
          200: '#b4d8cb',
          300: '#88bfaa',
          400: '#5B8A75',
          500: '#4a7562',
          600: v('--c-primary-600'),
          700: '#314f42',
          800: '#284138',
          900: '#1f322c',
        },
        ink: v('--c-ink'),
        muted: v('--c-muted'),
        surface: v('--c-surface'),
        'surface-2': v('--c-surface-2'),
        border: v('--c-border'),
        card: v('--c-card'),
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
