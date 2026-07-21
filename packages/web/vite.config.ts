import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The app version (from package.json) and the exact commit it was built from
// are baked in at build time so the running app can report them and link back
// to the git repository. In environments without a .git checkout (a Docker
// build), the commit falls back to the VITE_GIT_SHA env var, then to "dev".
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

function gitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(gitSha()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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
