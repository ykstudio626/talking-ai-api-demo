import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage } from 'node:http';

// const REALTIME_MODEL = 'gpt-4o-mini-realtime-preview'; // session.ts も変更すること
const REALTIME_MODEL = 'gpt-realtime-1.5';

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
    tailwindcss(),
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

            // Step 1: エフェメラルトークン取得
            const sessionRes = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ session: { type: 'realtime', model: REALTIME_MODEL } }),
            });
            if (!sessionRes.ok) {
              const errText = await sessionRes.text();
              res.statusCode = sessionRes.status;
              res.end(`[Step1 session失敗] ${errText}`);
              return;
            }
            const sessionData = await sessionRes.json() as { value?: string };
            const ephemeralKey = sessionData.value;
            if (!ephemeralKey) {
              res.statusCode = 500;
              res.end(`[Step1 token取得失敗] レスポンス: ${JSON.stringify(sessionData)}`);
              return;
            }

            // Step 2: エフェメラルトークンで SDP 交換
            const response = await fetch(
              `https://api.openai.com/v1/realtime/calls?model=${REALTIME_MODEL}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ephemeralKey}`,
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
