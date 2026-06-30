import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#5B8A75',
          50: '#f0f7f4',
          100: '#d9ece5',
          200: '#b4d8cb',
          300: '#88bfaa',
          400: '#5B8A75',
          500: '#4a7562',
          600: '#3c6050',
          700: '#314f42',
          800: '#284138',
          900: '#1f322c',
        },
        ink: '#1a1a1a',
        muted: '#6b7280',
        surface: '#f8f6f2',
        'surface-2': '#f0ede8',
        border: '#e2ddd8',
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
