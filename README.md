# おはなしチャッピー

OpenAI Realtime API (WebRTC) と VRM アバターを組み合わせた、リアルタイム音声会話デモアプリです。

## 概要

ブラウザのマイクから音声入力し、OpenAI の `gpt-4o-realtime-preview` モデルとリアルタイムで音声会話ができます。会話中はアバター（VRM）が口パクやアイドルアニメーションを行います。

## 技術スタック

- **フロントエンド**: TypeScript + Vite
- **3D レンダリング**: Three.js + @pixiv/three-vrm
- **音声会話**: OpenAI Realtime API (WebRTC / SDP)
- **バックエンド**: Vercel Serverless Functions
- **デプロイ**: Vercel

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env` ファイルをプロジェクトルートに作成し、OpenAI API キーを設定します。

```env
OPENAI_API_KEY=sk-...
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開いてください。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルド結果のプレビュー |
| `npm run watch` | ウォッチモードでビルド |

## デプロイ (Vercel)

```bash
vercel deploy
```

Vercel の環境変数に `OPENAI_API_KEY` を設定してください。

## ディレクトリ構成

```
.
├── api/
│   └── session.ts        # Vercel Serverless Function（OpenAI Realtime API プロキシ）
├── src/
│   ├── main.ts           # WebRTC セッション管理・チャット表示
│   ├── avatar.ts         # VRM アバター描画・アニメーション
│   ├── types.ts          # グローバル型定義
│   └── style.css         # スタイル
├── public/
│   └── model-data/       # VRM モデルファイル
├── index.html
└── vercel.json
```

## 主な機能

- **リアルタイム音声会話**: WebRTC を使い低遅延で AI と会話
- **音声文字起こし**: Whisper-1 によるユーザー発話のテキスト表示
- **VRM アバター**: 会話中の口パク、まばたき、アイドルアニメーション
- **マイク自動ミュート**: AI 応答中はマイクをミュートしてエコーを防止
- **オービットコントロール**: マウスでアバターの視点を操作可能

## その他（注意事項、備考）

- マイクへのアクセス許可が必要です
- 適当なVRMモデルがバンドルされていますが、お好みのアバターと差し替え可能です
- **会話の記録は一切行っていません。** お気軽にお楽しみください。
- 技術的に気になったこと（OpenAI Realtime APIで使われるeventなど）を doc/technical.md にメモってますので興味があれば目を通してみてください。

## 今後の展開
- キャラクターの設定（モデル・声・性格等）
- パラメータ設定画面（特にVAD関係）
- Reactコンポーネント化 + Next.js
- function callingを使った何か

## PR・要望
- 歓迎します！