import type { VercelRequest, VercelResponse } from '@vercel/node';

// const REALTIME_MODEL = 'grok-voice-think-fast-1.0';
const REALTIME_MODEL = 'grok-voice-latest';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // Debug: 出力は存在確認のみ（値は出力しない）
  console.log('DEBUG: XAI_API_KEY present:', !!process.env['XAI_API_KEY'], 'NODE_ENV:', process.env.NODE_ENV);

  const apiKey = process.env['XAI_API_KEY'];
  if (!apiKey) {
    res.status(500).json({ error: 'XAI_API_KEY が設定されていません' });
    return;
  }

  const sessionRes = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expires_after: { seconds: 300 } }),
  });

  if (!sessionRes.ok) {
    res.status(sessionRes.status).send(await sessionRes.text());
    return;
  }

  const sessionData = await sessionRes.json() as { value?: string };
  const ephemeralKey = sessionData.value;
  if (!ephemeralKey) {
    res.status(500).json({ error: 'エフェメラルトークンの取得に失敗しました' });
    return;
  }

  res.status(200).json({ ephemeralKey, model: REALTIME_MODEL });
}
