import './avatar';
import './style.css';
import type { ChatEntry, UserPlaceholder } from './types';

/* ===============================
   設定
================================ */
const PROXY_URL = '/api/session';
const EVENT_LOG = true;
const AUTO_START = true;
const AUTO_START_MESSAGE = 'こんにちは、あなたのニックネームを教えてくれるかな？';

const DISP_SITE_HEADER    = false;  // サイトヘッダーを表示
const DISP_CHAT_CONTAINER = false;  // チャットウインドウを表示
const DISP_USER_CHAT      = true;  // ユーザの発話を表示（falseの場合は文字起こし処理もスキップ）
const DISP_AI_CHAT        = true;  // AIの発話を表示

/* ===============================
   状態変数
================================ */
let pc               : RTCPeerConnection | null  = null;
let dc               : RTCDataChannel | null     = null;
let currentResponseId: string | null             = null;
let micTrack         : MediaStreamTrack | null   = null;
let audioCtx         : AudioContext | null       = null;
let mouthAnimId      : number | null             = null;

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

/* ===============================
   ボタンイベント
================================ */
(document.getElementById('startBtn') as HTMLButtonElement).onclick = startSession;
(document.getElementById('stopBtn')  as HTMLButtonElement).onclick = stopSession;

if (AUTO_START) startSession();

/* ===============================
   セッション開始
================================ */
async function startSession(): Promise<void> {
  try {
    pc = new RTCPeerConnection();

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);

    pc.ontrack = (event: RTCTrackEvent) => {
      audioEl.srcObject = event.streams[0];
      console.log('🎧 Remote audio track received');

      audioCtx = new AudioContext();
      const source   = audioCtx.createMediaStreamSource(event.streams[0]);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);

      function updateRms(): void {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (const v of dataArray) sum += (v - 128) ** 2;
        window.currentRms = Math.sqrt(sum / dataArray.length);
        mouthAnimId = requestAnimationFrame(updateRms);
      }
      updateRms();
    };

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micTrack = micStream.getAudioTracks()[0] ?? null;
    micStream.getTracks().forEach(track => pc!.addTrack(track, micStream));
    console.log('🎤 Mic input added');

    dc = pc.createDataChannel('oai-events');

    dc.onopen = () => {
      console.log('✅ Data channel open');
      window.avatarPaused = false;
      const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
      startBtn.textContent = '会話中…';
      startBtn.classList.add('active');
      startBtn.disabled = true;
      (document.getElementById('stopBtn') as HTMLButtonElement).disabled = false;

      dc!.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: 'あなたは日本語で会話するアシスタントです。必ず日本語で応答してください。',
          input_audio_transcription: { model: 'whisper-1' },
          voice: 'shimmer',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      }));

      if (AUTO_START) {
        dc!.send(JSON.stringify({
          type: 'response.create',
          response: {
            instructions: `「${AUTO_START_MESSAGE}」とだけ言ってください。`,
          },
        }));
      }
    };

    dc.onmessage = (evt: MessageEvent) => {
      const msg       = JSON.parse(evt.data as string) as Record<string, unknown>;
      const eventName = typeof msg['type'] === 'string' ? msg['type'] : 'unknown';
      if (EVENT_LOG) console.log(`📩 [${eventName}]`, msg);

      // AI応答フラグ・レスポンスID管理 + マイクミュート制御
      if (msg['type'] === 'response.created') {
        currentResponseId = (msg['response'] as Record<string, string> | undefined)?.['id'] ?? null;
        if (micTrack) micTrack.enabled = false;
        if (EVENT_LOG) console.log('▶ response started: mic OFF', currentResponseId);
      }
      if (msg['type'] === 'response.done' || msg['type'] === 'response.cancelled') {
        currentResponseId = null;
        if (micTrack) micTrack.enabled = true;
        if (EVENT_LOG) console.log('⏹ response done: mic ON');
      }

      // 1) conversation.item.created
      if (msg['type'] === 'conversation.item.created') {
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

      // 2) response.audio_transcript.delta
      if (msg['type'] === 'response.audio_transcript.delta' && DISP_AI_CHAT) {
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

      // 3) 文字起こし完了
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

      // 4) response.audio_transcript.done
      if (msg['type'] === 'response.audio_transcript.done') {
        const itemId = (msg['item_id'] ?? (msg['item'] as Record<string, string> | undefined)?.['id']) as string | undefined;
        if (!itemId) return;
        const entry = aiParagraphs.get(itemId);
        if (entry) {
          if (entry.appended) entry.p.textContent = entry.p.textContent.trim();
          aiParagraphs.delete(itemId);
        }
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(PROXY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body:    offer.sdp,
    });

    if (!sdpResponse.ok) {
      const errText = await sdpResponse.text();
      if (sdpResponse.status === 429) {
        throw new Error('アクセスが集中しています。しばらく待ってから再試行してください。');
      }
      throw new Error(`セッション開始失敗 (${sdpResponse.status}): ${errText}`);
    }

    const answer: RTCSessionDescriptionInit = { type: 'answer', sdp: await sdpResponse.text() };
    await pc.setRemoteDescription(answer);
    console.log('🎤 Session started');

  } catch (err) {
    console.error('❌ Error:', err);
    const msg = err instanceof Error ? err.message : 'エラーが発生しました。詳細はコンソールを確認してください。';
    log(msg);
    stopSession();
  }
}

/* ===============================
   セッション終了
================================ */
function stopSession(): void {
  if (micTrack)    { micTrack.enabled = true;            micTrack = null; }
  if (dc)          { dc.close();                         dc = null; }
  if (pc)          { pc.close();                         pc = null; }
  if (mouthAnimId) { cancelAnimationFrame(mouthAnimId);  mouthAnimId = null; }
  if (audioCtx)    { void audioCtx.close();              audioCtx = null; }
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
