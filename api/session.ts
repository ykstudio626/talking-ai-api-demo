import type { VercelRequest, VercelResponse } from '@vercel/node';

// const REALTIME_MODEL = 'gpt-4o-mini-realtime-preview'; // vite.configの方も変更すること
const REALTIME_MODEL = 'gpt-realtime-1.5';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY が設定されていません' });
    return;
  }

  const sessionRes = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session: { type: 'realtime', model: REALTIME_MODEL } }),
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
