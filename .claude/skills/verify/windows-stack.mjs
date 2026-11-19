// Throwaway test stack: a portable Postgres and a minimal Redis stand-in.
import EmbeddedPostgres from 'embedded-postgres';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'pgdata');
const fresh = !fs.existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'parecare',
  password: 'parecare',
  port: 5433,
  persistent: true,
});
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('parecare');
console.log('postgres up on 5433');

// Minimal RESP server: enough for connect, PING, PUBLISH and SUBSCRIBE.
const enc = (v) => {
  if (v === null) return '$-1\r\n';
  if (typeof v === 'number') return `:${v}\r\n`;
  if (Array.isArray(v)) return `*${v.length}\r\n` + v.map(enc).join('');
  if (v && v.simple) return `+${v.simple}\r\n`;
  return `$${Buffer.byteLength(String(v))}\r\n${v}\r\n`;
};
function parse(buf) {
  const cmds = [];
  let i = 0;
  const s = buf.toString('utf8');
  while (i < s.length) {
    if (s[i] !== '*') break;
    const nl = s.indexOf('\r\n', i);
    const n = parseInt(s.slice(i + 1, nl), 10);
    i = nl + 2;
    const args = [];
    for (let k = 0; k < n; k++) {
      const nl2 = s.indexOf('\r\n', i);
      const len = parseInt(s.slice(i + 1, nl2), 10);
      i = nl2 + 2;
      args.push(s.slice(i, i + len));
      i += len + 2;
    }
    cmds.push(args);
  }
  return cmds;
}
const store = new Map();
net
  .createServer((sock) => {
    sock.on('data', (buf) => {
      for (const [cmd, ...args] of parse(buf)) {
        const c = cmd.toUpperCase();
        if (c === 'PING') sock.write(enc({ simple: 'PONG' }));
        else if (c === 'PUBLISH') sock.write(enc(0));
        else if (c === 'SUBSCRIBE') args.forEach((ch, idx) => sock.write(enc(['subscribe', ch, idx + 1])));
        else if (c === 'GET') sock.write(enc(store.get(args[0]) ?? null));
        else if (c === 'SET') { store.set(args[0], args[1]); sock.write(enc({ simple: 'OK' })); }
        else if (c === 'DEL') { sock.write(enc(store.delete(args[0]) ? 1 : 0)); }
        else if (c === 'INCR') { const v = Number(store.get(args[0]) ?? 0) + 1; store.set(args[0], String(v)); sock.write(enc(v)); }
        else if (c === 'EXPIRE' || c === 'PEXPIRE') sock.write(enc(1));
        else sock.write(enc({ simple: 'OK' }));
      }
    });
    sock.on('error', () => {});
  })
  .listen(6380, '127.0.0.1', () => console.log('redis stand-in up on 6380'));

const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
