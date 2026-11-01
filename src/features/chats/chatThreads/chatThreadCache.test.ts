import { QueryClient } from '@tanstack/react-query';

import { chatThreadQueryKey, loadChatThread } from './chatThreadCache';
import type { ChatThreadHistory } from './chatThreadCache';

import { listChatThread, listDeletedMessageIds, listMessagesByIds } from '@/api/chats';
import type { ChatMessage } from '@/features/chats/messages/types';
import { original } from '@/test/islands';

jest.mock('@/api/chats', () => ({
  listChatThread: jest.fn(), listDeletedMessageIds: jest.fn(), listMessagesByIds: jest.fn(),
  deletedChatThreadRoot: (chatId: string, id: string, seq: number) => ({
    id, chatId, seq, replies: [], chatThreadDeletedRoot: true,
  }),
}));

const page = jest.mocked(listChatThread);
const messages = jest.mocked(listMessagesByIds);
const deleted = jest.mocked(listDeletedMessageIds);
const message = (id: string, seq: number): ChatMessage => ({ ...original({ id, seq }), status: 'sent' });

afterEach(() => jest.resetAllMocks());

it.each([30, 31])('тред из %i ответов: разрыв существует только при пропущенных ответах', async (count) => {
  const replies = Array.from({ length: count }, (_, i) => message(`r${i + 1}`, (i + 1) * 5));
  messages.mockResolvedValue([message('root', 0)]);
  page.mockImplementation(async (_root, params) => ({
    items: params?.beforeSeq ? replies.slice(-10) : replies.slice(0, 21),
    quotes: {}, full: true,
  }));
  const client = new QueryClient();
  const loaded = await loadChatThread(client, 'chat', 'root');
  expect(loaded.gap !== null).toBe(count > 30);
  expect(loaded.items).toHaveLength(31);
  client.clear();
});

it('после обрыва связи перечитывает правки старых ответов, сохраняя разрыв', async () => {
  const client = new QueryClient();
  const cached: ChatThreadHistory = {
    items: [message('newest', 100), message('old', 10), message('root', 0)],
    nextCursor: null, rootId: 'root', quotes: { old: [] }, gap: { afterSeq: 10, beforeSeq: 100 },
  };
  client.setQueryData(chatThreadQueryKey('chat', 'root'), cached);
  page.mockResolvedValue({ items: [], quotes: {}, full: false });
  deleted.mockResolvedValue([]);
  messages.mockResolvedValue([{ ...message('old', 10), text: 'правка во время обрыва', edited: true }]);
  const fresh = await loadChatThread(client, 'chat', 'root');
  expect(fresh.items.find((item) => item.id === 'old')?.text).toBe('правка во время обрыва');
  expect(fresh.gap).toEqual(cached.gap);
  expect(fresh.items.map((item) => item.id)).toEqual(['newest', 'old', 'root']);
  client.clear();
});
