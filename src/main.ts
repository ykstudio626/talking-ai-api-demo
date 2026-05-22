import './avatar';
import './style.css';
import type { ChatEntry, UserPlaceholder } from './types';
import sampleRag from './rag/sample.txt?raw';

/* ===============================
   設定
================================ */
const PROXY_URL = '/api/session';
const EVENT_LOG_DEFAULT = true;
const EVENT_LOG =
  import.meta.env['EVENT_LOG'] !== undefined
    ? import.meta.env['EVENT_LOG'] === 'true'
    : EVENT_LOG_DEFAULT;
const AUTO_START = true;
const AUTO_START_MESSAGE = 'こんにちは、あなたのニックネームを教えてくれるかな？';

const MAINTENANCE_MODE_DEFAULT = false;
const MAINTENANCE_MODE =
  import.meta.env['VITE_MAINTENANCE_MODE'] !== undefined
    ? import.meta.env['VITE_MAINTENANCE_MODE'] === 'true'
    : MAINTENANCE_MODE_DEFAULT;

const DISP_SITE_HEADER    = true;  // サイトヘッダーを表示
const DISP_CHAT_CONTAINER = true;  // チャットウインドウを表示
const DISP_USER_CHAT      = true;  // ユーザの発話を表示（falseの場合は文字起こし処理もスキップ）
const DISP_AI_CHAT        = true;  // AIの発話を表示

// const REALTIME_MODEL = 'gpt-4o-mini-realtime-preview'; // api/session.ts・vite.config.ts も変更すること
const REALTIME_MODEL = 'gpt-realtime-1.5';

const INSTRUCTIONS = `あなたはユーザーと気軽に会話するアシスタントです。
- 日本語が基本ですが、ユーザーの要望に応じて外国語を話しても構いません。
- 会話の長さはなるべく150文字以内としてください`;
const VOICE           = 'shimmer';
// const VOICE           = 'marin'; // 女性ボイス
const VAD_THRESHOLD   = 0.7;  // 0〜1、高いほどノイズに鈍感

const DEMO_MODE_DEFAULT = false;
const DEMO_MODE =
  import.meta.env['VITE_DEMO_MODE'] !== undefined
    ? import.meta.env['VITE_DEMO_MODE'] === 'true'
    : DEMO_MODE_DEFAULT;
const DEMO_MODE_RESTRICTION_DEFAULT = 10;
const DEMO_MODE_RESTRICTION =
  import.meta.env['VITE_DEMO_MODE_RESTRICTION'] !== undefined
    ? (parseInt(import.meta.env['VITE_DEMO_MODE_RESTRICTION'], 10) || DEMO_MODE_RESTRICTION_DEFAULT)
    : DEMO_MODE_RESTRICTION_DEFAULT;

const ragContext = [sampleRag].filter(Boolean).join('\n\n');

/* ===============================
   状態変数
================================ */
let ws              : WebSocket | null           = null;
let captureCtx      : AudioContext | null        = null;
let playbackCtx     : AudioContext | null        = null;
let playbackAnalyser: AnalyserNode | null        = null;
let scriptProcessor : ScriptProcessorNode | null = null;
let micTrack        : MediaStreamTrack | null    = null;
let nextPlayTime    : number                     = 0;
let mouthAnimId     : number | null              = null;
let currentResponseId: string | null             = null;
let demoResponseCount: number                    = 0;

window.currentRms   = 0;
window.avatarPaused = true;

const chatContainer        = document.getElementById('chatContainer') as HTMLDivElement;
const aiParagraphs         = new Map<string, ChatEntry>();
const userPlaceholderQueue : UserPlaceholder[] = [];

/* ===============================
   表示初期化
================================ */
if (!DISP_SITE_HEADER)    (document.getElementById('site-header')    as HTMLElement).style.display = 'none';
if (!DISP_CHAT_CONTAINER) (document.getElementById('chatContainer')  as HTMLElement).style.display = 'none';

if (MAINTENANCE_MODE) {
  (document.getElementById('maintenanceOverlay') as HTMLElement).classList.remove('hidden');
  (document.getElementById('startBtn') as HTMLButtonElement).disabled = true;
  (document.getElementById('startBtn') as HTMLButtonElement).classList.add('opacity-40', 'cursor-not-allowed');
  (document.getElementById('stopBtn') as HTMLButtonElement).disabled = true;
  (document.getElementById('stopBtn') as HTMLButtonElement).classList.add('opacity-40', 'cursor-not-allowed');
}

/* ===============================
   ボタンイベント
================================ */
(document.getElementById('startBtn') as HTMLButtonElement).onclick = startSession;
(document.getElementById('stopBtn')  as HTMLButtonElement).onclick = stopSession;

if (AUTO_START && !MAINTENANCE_MODE) startSession();

/* ===============================
   セッション開始
================================ */
async function startSession(): Promise<void> {
  try {
    // Step 1: エフェメラルトークン取得
    const tokenRes = await fetch(PROXY_URL, { method: 'POST' });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      if (tokenRes.status === 429) {
        (document.getElementById('demoLimitOverlay') as HTMLElement).classList.remove('hidden');
        (document.getElementById('startBtn') as HTMLButtonElement).disabled = true;
        return;
      }
      throw new Error(`トークン取得失敗 (${tokenRes.status}): ${errText}`);
    }
    const { ephemeralKey } = await tokenRes.json() as { ephemeralKey: string };

    // Step 2: マイク取得
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micTrack = micStream.getAudioTracks()[0] ?? null;
    if (micTrack) micTrack.enabled = false; // 最初の応答が終わるまで送信を抑制

    // Step 3: 音声キャプチャ設定（24kHz PCM16）
    captureCtx = new AudioContext({ sampleRate: 24000 });
    const source = captureCtx.createMediaStreamSource(micStream);
    scriptProcessor = captureCtx.createScriptProcessor(4096, 1, 1);
    const muteNode = captureCtx.createGain();
    muteNode.gain.value = 0;
    source.connect(scriptProcessor);
    scriptProcessor.connect(muteNode);
    muteNode.connect(captureCtx.destination);

    // Step 4: 再生コンテキスト設定（アバター口パク用アナライザー付き）
    playbackCtx      = new AudioContext({ sampleRate: 24000 });
    void playbackCtx.resume();
    playbackAnalyser = playbackCtx.createAnalyser();
    playbackAnalyser.fftSize = 256;
    playbackAnalyser.connect(playbackCtx.destination);
    nextPlayTime = 0;

    const rmsData = new Uint8Array(playbackAnalyser.fftSize);
    function updateRms(): void {
      playbackAnalyser!.getByteTimeDomainData(rmsData);
      let sum = 0;
      for (const v of rmsData) sum += (v - 128) ** 2;
      window.currentRms = Math.sqrt(sum / rmsData.length);
      mouthAnimId = requestAnimationFrame(updateRms);
    }
    updateRms();

    // Step 5: WebSocket 接続
    ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
      ['realtime', `openai-insecure-api-key.${ephemeralKey}`],
    );

    ws.onopen = () => {
      console.log('✅ WebSocket open');
      window.avatarPaused = false;
      const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
      startBtn.textContent = '会話中…';
      startBtn.classList.add('active');
      startBtn.disabled = true;
      (document.getElementById('stopBtn') as HTMLButtonElement).disabled = false;

      ws!.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: ragContext ? `${INSTRUCTIONS}\n\n## 必要に応じて以下のナレッジを参照すること\n${ragContext}` : INSTRUCTIONS,
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: {
                type: 'server_vad',
                threshold: VAD_THRESHOLD,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
            output: {
              voice: VOICE,
            },
          },
        },
      }));

      if (AUTO_START) {
        ws!.send(JSON.stringify({
          type: 'response.create',
          response: {
            instructions: `「${AUTO_START_MESSAGE}」とだけ言ってください。`,
          },
        }));
      }

      // 音声ストリーミング開始
      scriptProcessor!.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!micTrack?.enabled) return;
        // AI音声再生中はマイク送信を抑制してエコーを防ぐ
        if (playbackCtx && nextPlayTime > playbackCtx.currentTime) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const pcm16   = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32768)));
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary  = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: btoa(binary) }));
      };
    };

    ws.onmessage = (evt: MessageEvent) => {
      const msg       = JSON.parse(evt.data as string) as Record<string, unknown>;
      const eventName = typeof msg['type'] === 'string' ? msg['type'] : 'unknown';
      if (EVENT_LOG) console.log(`📩 [${eventName}]`, msg);
      if (msg['type'] === 'error') console.error('⚠️ API Error:', JSON.stringify(msg));

      // マイクミュート制御
      if (msg['type'] === 'response.created') {
        currentResponseId = (msg['response'] as Record<string, string> | undefined)?.['id'] ?? null;
        if (micTrack) micTrack.enabled = false;
        if (EVENT_LOG) console.log('▶ response started: mic OFF', currentResponseId);
      }
      if (msg['type'] === 'response.done' || msg['type'] === 'response.cancelled') {
        currentResponseId = null;
        if (micTrack) micTrack.enabled = true;
        if (EVENT_LOG) console.log('⏹ response done: mic ON');
        if (DEMO_MODE && msg['type'] === 'response.done') {
          demoResponseCount++;
          if (demoResponseCount >= DEMO_MODE_RESTRICTION) {
            stopSession();
            (document.getElementById('demoLimitOverlay') as HTMLElement).classList.remove('hidden');
            (document.getElementById('startBtn') as HTMLButtonElement).disabled = true;
          }
        }
      }

      // 音声再生
      if (msg['type'] === 'response.output_audio.delta') {
        const audio = msg['delta'] as string | undefined;
        if (audio) appendAudio(audio);
      }

      // 1) conversation.item.created / conversation.item.added (GA)
      if (msg['type'] === 'conversation.item.created' || msg['type'] === 'conversation.item.added') {
        const item   = msg['item'] as Record<string, string> | undefined;
        const itemId = item?.['id'];
        const role   = item?.['role'];
        if (!itemId || aiParagraphs.has(itemId)) return;

        if (role === 'user') {
          if (!DISP_USER_CHAT) return;
          const p = document.createElement('p');
          p.className   = 'user';
          p.textContent = 'You: …';
          chatContainer.appendChild(p);
          scrollToBottom();
          const userEntry: ChatEntry = { p, appended: true, isUser: true };
          aiParagraphs.set(itemId, userEntry);
          userPlaceholderQueue.push({ itemId, entry: userEntry });
          console.log('🗣 User item created, id:', itemId);
        } else {
          if (!DISP_AI_CHAT) return;
          const p = document.createElement('p');
          p.className   = 'ai';
          p.textContent = '';
          aiParagraphs.set(itemId, { p, appended: false });
        }
      }

      // 2) response.output_audio_transcript.delta
      if (msg['type'] === 'response.output_audio_transcript.delta' && DISP_AI_CHAT) {
        const responseId = msg['response_id'] as string | undefined;
        if (currentResponseId && responseId && responseId !== currentResponseId) return;

        const itemId    = (msg['item_id'] ?? (msg['item'] as Record<string, string> | undefined)?.['id']) as string | undefined;
        const deltaText = (msg['delta'] ?? msg['text'] ?? '') as string;
        if (!deltaText) return;

        const entry = itemId ? aiParagraphs.get(itemId) : undefined;
        if (!entry) {
          const p = document.createElement('p');
          p.className   = 'ai';
          p.textContent = 'AI: ' + deltaText;
          chatContainer.appendChild(p);
          aiParagraphs.set(itemId ?? ('unknown_' + Date.now()), { p, appended: true });
          scrollToBottom();
        } else if (!entry.appended) {
          entry.p.textContent = 'AI: ' + deltaText;
          chatContainer.appendChild(entry.p);
          entry.appended = true;
          scrollToBottom();
        } else {
          entry.p.textContent += deltaText;
          scrollToBottom();
        }
      }

      // 3a) 文字起こし完了（旧イベント、引き続き対応）
      if (msg['type'] === 'conversation.item.input_audio_transcription.completed' && DISP_USER_CHAT) {
        const itemId     = msg['item_id'] as string | undefined;
        const transcript = ((msg['transcript'] as string | undefined) ?? '').trim();
        console.log('📝 Transcription: item_id=', itemId, 'transcript=', transcript);
        if (!transcript) return;

        const entry = itemId ? aiParagraphs.get(itemId) : undefined;
        if (entry?.isUser) {
          entry.p.textContent = 'You: ' + transcript;
          const qi = userPlaceholderQueue.findIndex(q => q.itemId === itemId);
          if (qi !== -1) userPlaceholderQueue.splice(qi, 1);
        } else if (userPlaceholderQueue.length > 0) {
          const queued = userPlaceholderQueue.shift()!;
          queued.entry.p.textContent = 'You: ' + transcript;
        } else {
          const p = document.createElement('p');
          p.className   = 'user';
          p.textContent = 'You: ' + transcript;
          chatContainer.appendChild(p);
          scrollToBottom();
        }
      }

      // 3b) conversation.item.done からユーザー発話テキストを取得（GA API フォールバック）
      if (msg['type'] === 'conversation.item.done' && DISP_USER_CHAT) {
        const item   = msg['item'] as Record<string, unknown> | undefined;
        const itemId = item?.['id'] as string | undefined;
        const role   = item?.['role'] as string | undefined;
        if (role === 'user' && itemId) {
          const content  = item?.['content'] as Array<Record<string, unknown>> | undefined;
          const transcript = (content?.[0]?.['transcript'] as string | undefined)?.trim();
          const entry    = aiParagraphs.get(itemId);
          if (entry?.isUser && entry.p.textContent === 'You: …') {
            entry.p.textContent = transcript ? `You: ${transcript}` : 'You: 🎤';
            const qi = userPlaceholderQueue.findIndex(q => q.itemId === itemId);
            if (qi !== -1) userPlaceholderQueue.splice(qi, 1);
          }
        }
      }

      // 4) response.output_audio_transcript.done
      if (msg['type'] === 'response.output_audio_transcript.done') {
        const itemId = (msg['item_id'] ?? (msg['item'] as Record<string, string> | undefined)?.['id']) as string | undefined;
        if (!itemId) return;
        const entry = aiParagraphs.get(itemId);
        if (entry) {
          if (entry.appended) entry.p.textContent = entry.p.textContent.trim();
          aiParagraphs.delete(itemId);
        }
      }
    };

    ws.onerror = () => {
      console.error('❌ WebSocket error');
    };

    ws.onclose = (e: CloseEvent) => {
      console.log('🔌 WebSocket closed:', e.code, e.reason);
      if (e.code !== 1000) log(`接続が切断されました (${e.code})`);
      stopSession();
    };

    console.log('🎤 Session starting...');

  } catch (err) {
    console.error('❌ Error:', err);
    const msg = err instanceof Error ? err.message : 'エラーが発生しました。詳細はコンソールを確認してください。';
    log(msg);
    stopSession();
  }
}

/* ===============================
   音声再生（PCM16 base64 → AudioBuffer）
================================ */
function appendAudio(base64: string): void {
  if (!playbackCtx || !playbackAnalyser) return;
  if (playbackCtx.state === 'suspended') void playbackCtx.resume();
  const binary  = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const samples = bytes.length / 2;
  const float32 = new Float32Array(samples);
  const view    = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  const buffer = playbackCtx.createBuffer(1, samples, 24000);
  buffer.getChannelData(0).set(float32);
  const src  = playbackCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(playbackAnalyser);
  const startTime = Math.max(nextPlayTime, playbackCtx.currentTime + 0.01);
  src.start(startTime);
  nextPlayTime = startTime + buffer.duration;
}

/* ===============================
   セッション終了
================================ */
function stopSession(): void {
  if (ws)              { ws.close(1000);                          ws = null; }
  if (scriptProcessor) { scriptProcessor.disconnect();
                         scriptProcessor.onaudioprocess = null;   scriptProcessor = null; }
  if (captureCtx)      { void captureCtx.close();                 captureCtx = null; }
  if (micTrack)        { micTrack.stop();                         micTrack = null; }
  if (mouthAnimId)     { cancelAnimationFrame(mouthAnimId);       mouthAnimId = null; }
  // キュー済みの音声が再生し終わってからコンテキストを閉じる
  const pCtx = playbackCtx;
  if (pCtx) {
    const delay = Math.max(0, (nextPlayTime - pCtx.currentTime) * 1000) + 200;
    setTimeout(() => void pCtx.close(), delay);
  }
  playbackCtx       = null;
  playbackAnalyser  = null;
  nextPlayTime      = 0;
  window.currentRms   = 0;
  window.avatarPaused = true;
  currentResponseId = null;
  console.log('🛑 Session stopped');
  (document.getElementById('stopBtn') as HTMLButtonElement).disabled = true;
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  startBtn.textContent = '▶ 会話を開始';
  startBtn.classList.remove('active');
  startBtn.disabled = false;
  aiParagraphs.clear();
  userPlaceholderQueue.length = 0;
}

/* ===============================
   キーボードトグル
================================ */
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'd') {
    const el = document.getElementById('site-header') as HTMLElement;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }
  if (e.key === 'c' && (DISP_USER_CHAT || DISP_AI_CHAT)) {
    const el = document.getElementById('chatContainer') as HTMLElement;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }
});

/* ===============================
   補助関数
================================ */
function log(msg: string): void {
  const p = document.createElement('p');
  p.className   = 'error';
  p.textContent = msg;
  chatContainer.appendChild(p);
  scrollToBottom();
}

function scrollToBottom(): void {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
