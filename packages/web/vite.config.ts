import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://api:3001', rewrite: (p) => p.replace(/^\/api/, '') },
      '/webhooks': { target: 'http://api:3001' },
    },
  },
});
