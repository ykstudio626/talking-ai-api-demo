// Vercel Serverless Function
// クライアントから受け取った SDP offer を OpenAI Realtime API に中継するプロキシ
// OPENAI_API_KEY は Vercel の環境変数として設定し、クライアントには公開しない

export const config = {
  api: {
    bodyParser: false, // SDP(テキスト)をそのまま受け取るためパーサーを無効化
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY が設定されていません" });
  }

  // リクエストボディ（SDP テキスト）を読み取る
  const sdpOffer = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

  const model = "gpt-4o-realtime-preview";

  const response = await fetch(
    `https://api.openai.com/v1/realtime?model=${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/sdp",
      },
      body: sdpOffer,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return res.status(response.status).send(errorText);
  }

  const sdpAnswer = await response.text();
  res.setHeader("Content-Type", "application/sdp");
  res.status(200).send(sdpAnswer);
}
