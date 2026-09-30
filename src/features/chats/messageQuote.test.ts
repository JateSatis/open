import { describeMode, describePreview, quoteOf } from './messageQuote';

import { toPreview } from '@/api/messagePreview';
import type { ChatMessage } from '@/features/chats/messages/types';
import { original } from '@/test/islands';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'привет',
    createdAt: '2026-09-29T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    status: 'sent',
    ...overrides,
  };
}

function file(mimeType: string, url = 'https://cdn/x', posterUrl: string | null = null) {
  return {
    id: url,
    url,
    posterUrl,
    mimeType,
    width: 100,
    height: 100,
    durationMs: mimeType.startsWith('audio/') ? 12_400 : null,
    waveform: null,
  };
}

describe('describePreview', () => {
  it('shows the text itself on one line', () => {
    expect(describePreview(toPreview('text', 'первая\nвторая', []))).toBe('первая вторая');
  });

  it('names a single photo, a single video and an album', () => {
    const photo = message({ kind: 'media', text: null, attachments: [file('image/jpeg')] });
    const video = message({ kind: 'media', text: null, attachments: [file('video/mp4')] });
    const album = message({
      kind: 'media',
      text: null,
      attachments: [file('image/jpeg', 'a'), file('video/mp4', 'b')],
    });

    expect(describePreview(quoteOf(photo, 'Марина').preview)).toBe('Фото');
    expect(describePreview(quoteOf(video, 'Марина').preview)).toBe('Видео');
    expect(describePreview(quoteOf(album, 'Марина').preview)).toBe('Альбом');
  });

  it('prefers the caption of a media message', () => {
    const photo = message({ kind: 'media', text: 'закат', attachments: [file('image/jpeg')] });

    expect(describePreview(quoteOf(photo, 'Марина').preview)).toBe('закат');
  });

  it('gives a voice message its duration', () => {
    const voice = message({ kind: 'voice', text: null, attachments: [file('audio/mp4')] });

    expect(describePreview(quoteOf(voice, 'Марина').preview)).toBe('🎤 Голосовое сообщение (0:12)');
  });

  it('takes the thumbnail from the photo, or the poster of a video', () => {
    const video = message({
      kind: 'media',
      text: null,
      attachments: [file('video/mp4', 'https://cdn/v.mp4', 'https://cdn/v.jpg')],
    });

    expect(quoteOf(video, 'Марина').preview.thumbnailUrl).toBe('https://cdn/v.jpg');
  });
});

describe('quoteOf', () => {
  it('remembers the island a quoted original stands in', () => {
    const via = { forwardId: 'isl', createdAt: '2026-09-30T10:00:00Z' };

    expect(quoteOf(message(), 'Марина', via)).toMatchObject({ messageId: 'm1', via });
    expect(quoteOf(message(), 'Марина').via).toBeNull();
  });
});

describe('describeMode', () => {
  it('says whom a reply is to and what it quotes', () => {
    const quote = quoteOf(message(), 'Марина');

    expect(describeMode({ type: 'reply', quotes: [quote] })).toMatchObject({
      title: 'В ответ Марина',
      snippet: 'привет',
    });
  });

  it('counts a reply to several messages', () => {
    const quotes = [
      quoteOf(message({ id: 'a' }), 'Марина'),
      quoteOf(message({ id: 'b', authorId: 'user-1' }), 'Я'),
      quoteOf(message({ id: 'c' }), 'Марина'),
    ];

    expect(describeMode({ type: 'reply', quotes })).toMatchObject({
      title: 'В ответ на 3 сообщения',
      snippet: 'Марина, Я',
    });
  });

  it('names the author of a forwarded original and counts several', () => {
    const sourceChat = { id: 'chat-1', name: 'Разговор' };
    const one = { original: original({ id: 'a', text: 'привет', authorName: 'Марина' }) };
    const other = { original: original({ id: 'b', text: 'ещё', authorName: 'Марина' }) };

    expect(describeMode({ type: 'forward', sourceChat, items: [one] })).toMatchObject({
      title: 'Переслать: Марина',
      snippet: 'привет',
    });
    expect(describeMode({ type: 'forward', sourceChat, items: [one, other] }).title).toBe(
      'Переслать 2 сообщения',
    );
  });
});
