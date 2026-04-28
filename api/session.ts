import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: false,
  },
};

function readBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

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
    res.status(response.status).send(await response.text());
    return;
  }

  res.setHeader('Content-Type', 'application/sdp');
  res.status(200).send(await response.text());
}
