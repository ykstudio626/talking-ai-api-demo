// avatar.ts と main.ts 間で共有する window グローバル変数の型定義

declare global {
  interface Window {
    currentRms: number;    // AI音声のRMS値（口パク用）
    avatarPaused: boolean; // アバターアニメーション停止フラグ
    playMotion: (filename: string, zoom?: boolean) => void;
  }
}

// チャットエントリの型
export interface ChatEntry {
  p: HTMLParagraphElement;
  appended: boolean;
  isUser?: boolean;
}

// ユーザープレースホルダーキューの型
export interface UserPlaceholder {
  itemId: string;
  entry: ChatEntry;
}
