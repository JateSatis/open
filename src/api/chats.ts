// Signatures only — no implementation yet. Return types are placeholders
// until src/api/types.gen.ts exists (generated after the first migration)
// and these get replaced with the real Database row types.

export type ChatSummary = {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
};

export type Message = {
  id: string;
  chatId: string;
  authorId: string;
  kind: 'text' | 'photo' | 'video' | 'voice' | 'video_note' | 'system';
  text: string | null;
  createdAt: string;
};

export type SendMessageInput = {
  text?: string;
  attachmentIds?: string[];
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export function listChats(): Promise<ChatSummary[]> {
  throw new Error('Not implemented');
}

export function getChat(chatId: string): Promise<ChatSummary> {
  throw new Error('Not implemented');
}

export function listMessages(
  chatId: string,
  params: { cursor?: string; limit?: number },
): Promise<Page<Message>> {
  throw new Error('Not implemented');
}

export function sendMessage(chatId: string, input: SendMessageInput): Promise<Message> {
  throw new Error('Not implemented');
}
