// The repo's Vite config with every proxy pointed at the local API instead of
// the Docker hostname "api". Run from packages/web with --config <this file>.
import base from 'T:/dev/active/parecare/packages/web/vite.config.ts';

const target = 'http://127.0.0.1:3001';
const proxy = Object.fromEntries(
  Object.entries((base.server?.proxy ?? {}) as Record<string, object>).map(([k, v]) => [k, { ...v, target }])
);

export default { ...base, root: 'T:/dev/active/parecare/packages/web', server: { ...base.server, proxy } };
