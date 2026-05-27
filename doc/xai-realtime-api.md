# xAI Realtime API — OpenAI との差分メモ

xAI の Grok Voice Agent API (`grok-voice-latest`) は OpenAI Realtime API と非常に近い設計。
以下の変更点を把握しておけば移行可能。

---

## エンドポイント・認証

| 項目 | OpenAI | xAI |
|---|---|---|
| エフェメラルトークン URL | `https://api.openai.com/v1/realtime/client_secrets` | `https://api.x.ai/v1/realtime/client_secrets` |
| トークン取得 リクエスト body | `{ session: { type: 'realtime', model } }` | `{ expires_after: { seconds: 300 } }` |
| WebSocket URL | `wss://api.openai.com/v1/realtime?model=...` | `wss://api.x.ai/v1/realtime?model=...` |
| WS サブプロトコル | `['realtime', 'openai-insecure-api-key.{key}']` | `['{token}']`（トークンが `xai-client-secret.XXX` 形式のため 1 要素） |
| API キー環境変数 | `OPENAI_API_KEY` | `XAI_API_KEY` |

---

## モデル・音声

| 項目 | OpenAI | xAI |
|---|---|---|
| モデル | `gpt-realtime-1.5` / `gpt-4o-mini-realtime-preview` | `grok-voice-latest` / `grok-voice-think-fast-1.0` |
| 利用可能な音声 | alloy, echo, shimmer 等 | eve（女性/活発）, ara（女性/温か）, rex（男性/明瞭）, sal（中性/滑らか）, leo（男性/威厳） |

---

## イベント名の差分

| 種類 | OpenAI | xAI |
|---|---|---|
| AI 音声テキスト delta | `response.output_audio_transcript.delta` | `response.text.delta` |
| ユーザー文字起こし完了 | `conversation.item.input_audio_transcription.completed` | `input_audio_transcription.completed` |

その他の主要イベント（`response.output_audio.delta`, `response.done`, `response.cancelled`,
`response.created`, `conversation.item.created`, `conversation.item.done`）は同じ名前で動作する想定。

### OpenAI にあって xAI で未サポートのイベント
- `conversation.item.retrieve`
- `conversation.item.truncate`
- `input_audio_buffer.dtmf_event_received`
- `rate_limits.updated`

---

## session.update の差分

```jsonc
// OpenAI
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "...",
    "audio": {
      "input": {
        "transcription": { "model": "gpt-4o-mini-transcribe" },  // ← xAI では不要
        "turn_detection": { "type": "server_vad", "threshold": 0.7, ... }
      },
      "output": { "voice": "shimmer" }
    }
  }
}

// xAI — transcription.model を省略（Grok に内蔵）
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "...",
    "audio": {
      "input": {
        "turn_detection": { "type": "server_vad", "threshold": 0.85, ... }
      },
      "output": { "voice": "ara" }
    }
  }
}
```

VAD threshold のデフォルト値が xAI は 0.85（OpenAI は指定なし）。

---

## xAI 独自機能

- **ビルトインツール**: `web_search`, `x_search`（X/Twitter 検索）, `file_search`, `mcp`
- **音声クローニング**: カスタムボイス作成 API あり
- **言語**: 20+ 言語を自動検出

---

## 本プロジェクトへの適用（変更ファイル）

### `api/session.ts`（Vercel サーバーレス）
- `OPENAI_API_KEY` → `XAI_API_KEY`
- fetch URL を `https://api.x.ai/v1/realtime/client_secrets` へ
- リクエスト body を `{ expires_after: { seconds: 300 } }` に変更
- モデル定数を `grok-voice-latest` に変更

### `vite.config.ts`（ローカル開発ミドルウェア）
- `api/session.ts` と同じ変更

### `src/main.ts`
1. `REALTIME_MODEL = 'grok-voice-latest'`
2. `VOICE = 'ara'`（女性・温かみ）
3. WebSocket URL を `wss://api.x.ai/v1/realtime?model=${REALTIME_MODEL}` に変更
4. サブプロトコルを `[ephemeralKey]` に変更（1 要素のみ）
5. `session.update` 内の `transcription: { model: 'gpt-4o-mini-transcribe' }` を削除
6. イベントハンドラのイベント名を上記差分表に従って変更

### 環境変数
```
# ローカル (.env)
XAI_API_KEY=xai-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Vercel（本番）
XAI_API_KEY を追加し OPENAI_API_KEY は削除
```

---

## 参考リンク

- [xAI Voice Agent ドキュメント](https://docs.x.ai/developers/model-capabilities/audio/voice-agent)
- [xAI エフェメラルトークン](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens)
