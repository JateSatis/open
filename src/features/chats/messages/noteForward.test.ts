import { requestClient } from '@/api/requestClient';
import { QueryClient } from '@tanstack/react-query';

import { sendMessage, sendVoiceMessage } from '@/api/chats';
import { sendNoteForward } from '@/features/chats/messages/delivery';
import { outboxMessages, resetOutbox } from '@/features/chats/messages/outbox';
import { uploadAllMedia } from '@/features/media';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({
  sendMessage: jest.fn(),
  sendVoiceMessage: jest.fn(),
}));
jest.mock('@/features/media', () => ({ uploadAllMedia: jest.fn() }));

const photo = {
  id: 'att-1',
  url: 'user-1/photo/1.jpg',
  posterUrl: null,
  mimeType: 'image/jpeg',
  width: 100,
  height: 80,
  durationMs: null,
  waveform: null,
};
const voice = {
  ...photo,
  id: 'att-2',
  url: 'user-1/voice/2.m4a',
  mimeType: 'audio/mp4',
  width: null,
  height: null,
  durationMs: 3000,
  waveform: [1, 2, 3],
};

function sent(id: string) {
  return { id, chatId: 'chat-a', kind: 'text', attachments: [], replies: [] } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOutbox();
  (sendMessage as jest.Mock).mockImplementation(() => Promise.resolve(sent('m-1')));
  (sendVoiceMessage as jest.Mock).mockImplementation(() => Promise.resolve(sent('m-2')));
});

describe('sendNoteForward', () => {
  it('a note goes as my plain message with the same, already cleaned files — nothing is uploaded again', async () => {
    const context = { queryClient: new QueryClient(), chatId: 'chat-a', currentUserId: 'user-1' };

    const { delivered } = sendNoteForward(context, '', [
      { savedId: 'n-1', kind: 'post', text: 'с фото', attachments: [photo] },
      { savedId: 'n-2', kind: 'voice', text: null, attachments: [voice] },
    ]);

    // Облачка — сразу, до ответа сервера: моё сообщение, без пометки «переслано».
    const drafts = outboxMessages('chat-a');
    expect(drafts.map((message) => message.kind)).toEqual(['voice', 'media']);
    expect(
      drafts.every((message) => message.forward === null && message.replies.length === 0),
    ).toBe(true);

    await delivered;

    expect(uploadAllMedia).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('chat-a', {
      text: 'с фото',
      media: [expect.objectContaining({ url: 'user-1/photo/1.jpg', mimeType: 'image/jpeg' })],
    }, requestClient());
    expect(sendVoiceMessage).toHaveBeenCalledWith(
      'chat-a',
      expect.objectContaining({ url: 'user-1/voice/2.m4a', durationMs: 3000, waveform: [1, 2, 3] }), undefined, undefined, requestClient()
    );
  });
});
