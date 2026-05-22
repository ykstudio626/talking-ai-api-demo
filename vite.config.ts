import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// const REALTIME_MODEL = 'gpt-4o-mini-realtime-preview'; // session.ts も変更すること
const REALTIME_MODEL = 'gpt-realtime-1.5';

export default defineConfig(({ mode }) => {
  // .env ファイルから全変数を読み込む（VITE_ プレフィックスなしも含む）
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      port: 5173,
    },
    envPrefix: 'VITE_',
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
              const sessionRes = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ session: { type: 'realtime', model: REALTIME_MODEL } }),
              });

              if (!sessionRes.ok) {
                res.statusCode = sessionRes.status;
                res.end(await sessionRes.text());
                return;
              }

              const sessionData = await sessionRes.json() as { value?: string };
              const ephemeralKey = sessionData.value;
              if (!ephemeralKey) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'エフェメラルトークンの取得に失敗しました' }));
                return;
              }

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ ephemeralKey, model: REALTIME_MODEL }));
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
  };
});
