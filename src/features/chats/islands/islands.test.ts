import { contentOf, isBubbleRow, toChatRows } from './rows';

import type { Message } from '@/api/chats';
import {
  bumpCommentsCount,
  knownEdits,
  patchCommentCounts,
  patchReactions,
  removeIslandItems,
  removeMessages,
  replaceMessages,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';
import type { ChatMessage } from '@/features/chats/messages/types';
import { island, original } from '@/test/islands';

const sent = (message: Message): ChatMessage => ({ ...message, status: 'sent' });

function history(...items: Message[]): ChatHistory {
  return { items: items.map(sent), nextCursor: null };
}

const forward = () =>
  island('isl', '2026-09-30T10:00:00Z', [
    original({ id: 'o1', text: 'первое' }),
    original({ id: 'o2', text: 'второе' }),
  ]);

function originalsOf(result: ChatHistory) {
  return result.items[0].forward!.items.map((item) => item.original);
}

describe('island rows', () => {
  it('lays an island out as a plate and a row per bubble, bottom first like the list', () => {
    const rows = toChatRows([sent(forward())]);

    expect(rows.map((row) => row.key)).toEqual(['isl/o2', 'isl/o1', 'isl/header']);
    expect(rows.filter(isBubbleRow).map((row) => contentOf(row)?.text)).toEqual(['второе', 'первое']);
  });

  it('closes the frame under the last bubble only', () => {
    const rows = toChatRows([sent(forward())]);

    expect(rows.map((row) => (row.type === 'island-item' ? row.isLast : null))).toEqual([
      true,
      false,
      null,
    ]);
  });

  it('keeps rows of an unchanged message the same objects', () => {
    const message = sent(forward());

    expect(toChatRows([message])[0]).toBe(toChatRows([message])[0]);
  });
});

describe('an original shown in an island, in the cache', () => {
  it('becomes a stub when deleted, and the island stays', () => {
    const result = removeMessages(history(forward()), new Set(['o1']));

    expect(originalsOf(result).map((item) => item?.id ?? null)).toEqual([null, 'o2']);
  });

  it('takes an edit, keeping its author and chat', () => {
    const fresh = { ...original({ id: 'o1', text: 'поправлено' }), editedAt: '2026-10-01T00:00:00Z' };
    const result = replaceMessages(history(forward()), [
      { ...fresh, authorName: undefined, chat: undefined } as unknown as Message,
    ]);
    const [first] = originalsOf(result);

    expect(first).toMatchObject({ text: 'поправлено', authorName: 'Джиган' });
    expect(first?.chat?.name).toBe('Джиган и Самойлова');
    expect(knownEdits(result).get('o1')).toBe('2026-10-01T00:00:00Z');
  });

  it('takes fresh reactions and comment counts wherever it is shown', () => {
    const reactions = { members: { '🔥': 17 }, visitors: {}, mine: null };
    const withReactions = patchReactions(history(forward()), [{ id: 'o2', reactions }]);
    const withComments = patchCommentCounts(withReactions, [{ id: 'o2', commentsCount: 146 }]);

    expect(originalsOf(withComments)[1]).toMatchObject({ reactions, commentsCount: 146 });
  });

  it('counts my new comment at once, and gives it back if it failed', () => {
    const bumped = bumpCommentsCount(history(forward()), 'o1', 1);

    expect(originalsOf(bumped)[0]?.commentsCount).toBe(1);
    expect(originalsOf(bumpCommentsCount(bumped, 'o1', -1))[0]?.commentsCount).toBe(0);
  });

  it('leaves the history untouched when nothing concerns it', () => {
    const before = history(forward());

    expect(patchCommentCounts(before, [{ id: 'other', commentsCount: 3 }])).toBe(before);
  });
});

describe('taking bubbles out of an island', () => {
  it('removes them and drops the island with the last one', () => {
    const one = removeIslandItems(history(forward()), 'isl', new Set(['o1']));

    expect(originalsOf(one).map((item) => item?.id)).toEqual(['o2']);
    expect(removeIslandItems(one, 'isl', new Set(['o2'])).items).toEqual([]);
  });
});
