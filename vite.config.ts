import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';

/** Dev-only: lets the page POST canvas captures to disk (headless QA). */
function screenshotSink(): Plugin {
  return {
    name: 'screenshot-sink',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const b64 = Buffer.concat(chunks).toString('utf8').split(',').pop() ?? '';
          writeFileSync('shot.jpg', Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
  plugins: [screenshotSink()],
});
