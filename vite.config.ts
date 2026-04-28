import { defineConfig, loadEnv } from 'vite';
import type { IncomingMessage } from 'node:http';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default defineConfig(({ mode }) => {
  // .env ファイルから全変数を読み込む（VITE_ プレフィックスなしも含む）
  const env = loadEnv(mode, process.cwd(), '');

  return {
  server: {
    port: 5173,
  },
  plugins: [
    {
      name: 'local-api',
      // 開発時のみ /api/session を Vite ミドルウェアで処理
      // 本番は api/session.js（Vercel サーバーレス関数）が担当
      configureServer(server) {
        server.middlewares.use('/api/session', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          const apiKey = env['OPENAI_API_KEY'];
          if (!apiKey) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'OPENAI_API_KEY が設定されていません' }));
            return;
          }

          try {
            const sdpOffer = await readBody(req);
            const response = await fetch(
              'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/sdp',
                },
                body: sdpOffer,
              },
            );

            if (!response.ok) {
              res.statusCode = response.status;
              res.end(await response.text());
              return;
            }

            res.setHeader('Content-Type', 'application/sdp');
            res.statusCode = 200;
            res.end(await response.text());
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  }; // defineConfig のリターン
});
