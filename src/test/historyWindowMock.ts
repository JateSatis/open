// Adapter for existing screen fixtures. Dedicated element-history tests use
// explicit occurrence pages; these fixtures exercise the unchanged UI actions.
import { listMessages, listMessagesSince, listMessagesByIds } from '@/api/chats';
import type { HistoryItem, HistoryWindow, HistoryWindowRequest } from '@/api/historyWindow';
import type { Message } from '@/api/messageRows';

export function historyFixtureItems(messages: Message[]): HistoryItem[] {
  return messages.flatMap<HistoryItem>((message) =>
    message.forward?.items.length
      ? message.forward.items.map((item) => ({
          key: item.id,
          messageId: message.id,
          forwardItemId: item.id,
          originalId: item.messageId,
          position: { seq: message.seq, position: item.position },
          message: { ...message, forward: { ...message.forward!, items: [item] } },
        }))
      : [
          {
            key: message.id,
            messageId: message.id,
            forwardItemId: null,
            originalId: null,
            position: { seq: message.seq, position: 0 },
            message,
          },
        ],
  );
}
export async function fixtureHistoryWindow(
  chatId: string,
  request: HistoryWindowRequest,
): Promise<HistoryWindow> {
  if (request.mode === 'around') {
    const messages = await listMessagesByIds([request.messageId]);
    return {
      items: historyFixtureItems(messages),
      target: 'found',
      anchor: null,
      before: null,
      after: null,
      coverage: { lower: null, upper: null },
      syncCursor: 'h1.fixture',
      reachedStart: true,
      reachedEnd: true,
    };
  }
  const page =
    request.mode === 'after'
      ? { items: await listMessagesSince(chatId, request.cursor.seq), nextCursor: null }
      : await listMessages(chatId, { cursor: request.cursor?.seq });
  return {
    items: historyFixtureItems(page.items),
    target: 'none',
    anchor: null,
    before:
      page.nextCursor === null
        ? null
        : { chatId, direction: 'before', seq: page.nextCursor, position: 0 },
    after: null,
    coverage: { lower: null, upper: null },
    syncCursor: 'h1.fixture',
    reachedStart: page.nextCursor === null,
    reachedEnd: true,
  };
}
