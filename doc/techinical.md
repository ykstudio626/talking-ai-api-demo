## dc.onmessage 受信イベント一覧

このドキュメントは、クライアントの `dc.onmessage` （DataChannel 受信）で扱う主要なイベントと、その用途・重要フィールドを簡潔にまとめたものです。

- `response.created`
	- 説明: AI が応答を開始したことを示すイベント。
	- 使い方: `response.id` を保持して現在の応答を追跡し、古い応答の差分を無視するために使う。

- `response.done` / `response.cancelled`
	- 説明: 応答が正常に完了したか、キャンセルされたことを示す。\
	- 使い方: 応答中フラグ (`isAiResponding`) をクリアし、`currentResponseId` をリセットする。

- `conversation.item.created`
	- 説明: 会話アイテム（ユーザー／アシスタント）の生成通知。
	- 重要フィールド: `msg.item.id`, `msg.item.role`。
	- 使い方: 表示用の `<p>` 要素を準備し、ユーザー用プレースホルダーや AI の出力スロットを確保する。

- `response.audio_transcript.delta`
	- 説明: 音声→テキストの「途中」断片（ストリーミング差分）。`msg.delta` または `msg.text` に一部テキストが入る。
	- 重要フィールド: `msg.item_id` / `msg.item.id`, `msg.response_id`（応答IDが付く場合あり）、`msg.delta`。
	- 使い方: 対応する `item_id` の DOM 要素へ逐次追記。`response_id` が現在の応答と異なる場合は無視して二重表示を防ぐ。

- `response.audio_transcript.done`
	- 説明: 当該レスポンスの音声文字起こしが確定したことを示す。
	- 使い方: 一時的に保持していた Map から該当 `item_id` を削除し、表示をトリムして最終化する。

- `conversation.item.input_audio_transcription.completed`
	- 説明: ユーザーの録音（input audio）に対する文字起こしが完了した通知。
	- 重要フィールド: `msg.item_id`, `msg.transcript`。
	- 使い方: 事前に作成してあるユーザープレースホルダーを `item_id` で更新する。`item_id` が不一致の場合は古いキューを先に使うなどのフォールバック処理を行う。


補足

- 上記は本プロジェクトで実際に用いている主要イベントの抜粋です。Realtime API 側からは他にもセッション・エラー系やカスタムイベントが来る可能性があります。\
- 受信ログを全件出力してイベント名とペイロードを確認すると、未対応イベントの追加対応がしやすくなります。

サンプル受信処理（要旨）:

```js
dc.onmessage = (evt) => {
	const msg = JSON.parse(evt.data);
	switch (msg.type) {
		case 'response.created': /* start */ break;
		case 'response.audio_transcript.delta': /* append */ break;
		case 'conversation.item.input_audio_transcription.completed': /* user transcript */ break;
		// ...
	}
};
```

## Q&A（Claudeに聞いてみた）

### responseは音声ですか、テキストですか？

短く言うと：response は「音声」と「テキスト」の両方を含み得ます。

音声：合成音声は WebRTC のリモートオーディオトラックで届きます（pc.ontrack → MediaStream を audio 要素で再生）。

テキスト：文字起こし・逐次テキストは DataChannel 経由のイベントで届きます（代表例：response.audio_transcript.delta、response.audio_transcript.done、conversation.item.input_audio_transcription.completed）。

ライフサイクル通知：response.created / response.done 等は応答の開始・終了を示すメタイベントで、直接の音声データやテキストペイロードを持たないことが多いです。
GPT-5 mini • 0x

### conversationとresponseの違いは？

簡潔にまとめます。

conversation / conversation.item.*: 会話という「スレッド」と、その中の個々のアイテム（メッセージ）を表します。アイテムは msg.item.id と msg.item.role（user / assistant 等）を持ち、クライアントはこれを使って表示用の <p> プレースホルダーを作ったり、ユーザー音声の文字起こし（conversation.item.input_audio_transcription.completed）を該当アイテムへ差し込みます。

response / response.*: AI の「応答」単位（1 回の発話・出力）のライフサイクルを表します。response.created（開始）→
response.audio_transcript.delta（逐次テキスト）→
response.done（終了）
などのイベントがあり、msg.response.id で応答インスタンスを追跡します。音声は WebRTC のリモートトラックで届き、テキスト（逐次文字起こし）は DataChannel の response.audio_transcript.* 系で届きます。

実務上の使い分け（このリポジトリの例）:

conversation.item.created → DOM のプレースホルダー準備（item.id をキーにする）。
response.created → currentResponseId を更新して「現在の応答」を追跡。
response.audio_transcript.delta → item_id／response_id を照合して対応する DOM に逐次追記（古いレスポンスの差分は無視）。
要点：conversation はメッセージ単位の構造、response はAIが実際に生成する応答インスタンス（ライフサイクルとストリーム）です。どちらのID（item_id / response_id）を使うかで更新対象を決めます。


**音声とテキストは別チャネル（WebRTC トラック vs DataChannel）で独立にストリームされ** 、同時に来ることも順不同で来ることもあります。

要点：

音声：WebRTC のリモート MediaStream（pc.ontrack）で届く連続ストリーム。パケットやバッファの影響で再生が始まるタイミングは変わる。

テキスト：DataChannel 経由のイベント（例：response.audio_transcript.delta / ...done）で逐次差分が届く。差分は音声合成の進行に合わせて来ることが多いが、必ず同期するわけではない。

実務上の扱い：順序を期待せず、response_id／item_id／response.created/response.done 等で関連付け・整合性チェックする。古い response_id の差分は無視する、...done で最終化する等の設計が安定する。

遅延要因：合成処理、ネットワーク遅延、ブラウザのオーディオバッファなどで「テキストが先に全部来てから音声が来る」ことやその逆も起き得る。

短い実装アドバイス：音声は pc.ontrack で再生しつつ、DataChannel の差分を表示。response_id を照合して古い差分を捨て、response.done / response.audio_transcript.done で確定表示する、これが堅牢です。

