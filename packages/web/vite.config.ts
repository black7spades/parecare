import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API serves under /api/v1 itself — do not strip the prefix
      // (same bug nginx had, fixed in 9e26ac3)
      '/api': { target: 'http://api:3001' },
      '/webhooks': { target: 'http://api:3001' },
    },
  },
});
