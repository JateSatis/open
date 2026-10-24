import { QueryClient, type InfiniteData } from '@tanstack/react-query';

import type { ForwardedComment } from '@/api/chats';
import type { SavedMessage, SavedPage, SavedPin, WatchLaterPage } from '@/api/saved';
import { forwardNotice } from '@/features/chats/sendForwardPick';
import {
  savedMessagesQueryKey,
  savedPinsQueryKey,
  savedSummaryQueryKey,
  savedWatchLaterQueryKey,
} from '@/features/saved/keys';
import { savedMenuActions } from '@/features/saved/savedActions';
import { savedQuotesOf, savedSourceLabel } from '@/features/saved/savedCopy';
import { patchSaved, rollbackSaved, watchLaterOrder } from '@/features/saved/savedCache';
import { savedForwardBatches } from '@/features/saved/savedForward';
import { formatDayMonth } from '@/lib/dates';
import { original } from '@/test/islands';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/media', () => ({}));

function saved(id: string, seq: number, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id,
    seq,
    savedAt: '2026-10-20T10:00:00Z',
    sourceType: 'message',
    category: 'member',
    sourceChatId: 'chat-g',
    sourceMessageId: `msg-${id}`,
    sourceCommentId: null,
    sourceSeq: 1,
    commentMessageId: null,
    commentPopId: null,
    kind: 'text',
    text: `текст ${id}`,
    authorId: null,
    authorName: null,
    authorAvatarUrl: null,
    authorOpaque: false,
    originalAt: null,
    watchLaterAt: null,
    watchDoneAt: null,
    pinnedAt: null,
    attachments: [],
    tagIds: [],
    edited: false,
    replies: [],
    ...overrides,
  };
}

describe('watchLaterOrder', () => {
  it('puts active ones first, newest first, then done ones by the last check', () => {
    const items = [
      saved('done-old', 1, {
        watchLaterAt: '2026-10-01T00:00:00Z',
        watchDoneAt: '2026-10-02T00:00:00Z',
      }),
      saved('active-old', 2, { watchLaterAt: '2026-10-01T00:00:00Z' }),
      saved('done-new', 3, {
        watchLaterAt: '2026-09-01T00:00:00Z',
        watchDoneAt: '2026-10-05T00:00:00Z',
      }),
      saved('active-new', 4, { watchLaterAt: '2026-10-03T00:00:00Z' }),
      saved('active-tie', 5, { watchLaterAt: '2026-10-01T00:00:00Z' }),
    ];

    expect([...items].sort(watchLaterOrder).map((item) => item.id)).toEqual([
      'active-new',
      'active-tie',
      'active-old',
      'done-new',
      'done-old',
    ]);
  });
});

describe('patchSaved', () => {
  function client() {
    const queryClient = new QueryClient();
    const all: InfiniteData<SavedPage> = {
      pages: [{ items: [saved('a', 2), saved('b', 1)], nextCursor: null, prevCursor: null }],
      pageParams: [null],
    };
    const later: InfiniteData<WatchLaterPage> = {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    };

    queryClient.setQueryData(savedMessagesQueryKey, all);
    queryClient.setQueryData(savedWatchLaterQueryKey, later);
    queryClient.setQueryData<SavedPin[]>(savedPinsQueryKey, []);
    queryClient.setQueryData(savedSummaryQueryKey, { watchLaterPending: 0 });

    return queryClient;
  }

  const laterIds = (queryClient: QueryClient) =>
    queryClient
      .getQueryData<InfiniteData<WatchLaterPage>>(savedWatchLaterQueryKey)
      ?.pages.flatMap((page) => page.items.map((item) => item.id));

  it('adds to «Посмотреть позже», bumps the counter, and rolls back exactly', () => {
    const queryClient = client();
    const before = patchSaved(queryClient, ['a'], (item) => ({
      ...item,
      watchLaterAt: '2026-10-21T00:00:00Z',
    }));

    expect(laterIds(queryClient)).toEqual(['a']);
    expect(queryClient.getQueryData(savedSummaryQueryKey)).toEqual({ watchLaterPending: 1 });

    rollbackSaved(queryClient, before);

    expect(laterIds(queryClient)).toEqual([]);
    expect(queryClient.getQueryData(savedSummaryQueryKey)).toEqual({ watchLaterPending: 0 });
  });

  it('a pin goes last in the bar, a removed record leaves every list', () => {
    const queryClient = client();

    patchSaved(queryClient, ['b'], (item) => ({ ...item, pinnedAt: '2026-10-21T00:00:00Z' }));
    patchSaved(queryClient, ['a'], (item) => ({ ...item, pinnedAt: '2026-10-22T00:00:00Z' }));

    expect(queryClient.getQueryData<SavedPin[]>(savedPinsQueryKey)?.map((pin) => pin.id)).toEqual([
      'b',
      'a',
    ]);

    patchSaved(queryClient, ['a'], () => null);

    expect(queryClient.getQueryData<SavedPin[]>(savedPinsQueryKey)?.map((pin) => pin.id)).toEqual([
      'b',
    ]);
    expect(
      queryClient
        .getQueryData<InfiniteData<SavedPage>>(savedMessagesQueryKey)
        ?.pages[0].items.map((item) => item.id),
    ).toEqual(['b']);
  });
});

describe('savedMenuActions', () => {
  it('on «Посмотреть позже» there is no watched toggle, «Выбрать» or «Закрепить»', () => {
    const item = saved('a', 1, { watchLaterAt: '2026-10-21T00:00:00Z' });

    expect(savedMenuActions(item, 'later').map((action) => action.id)).toEqual([
      'reply',
      'copy',
      'forward',
      'delete',
    ]);
    expect(savedMenuActions(item, 'all').map((action) => action.id)).toEqual([
      'reply',
      'watch_toggle',
      'copy',
      'select',
      'pin',
      'forward',
      'delete',
    ]);
  });

  it('the watched row is a checkbox: «Просмотрено» checked, «Не просмотрено» empty', () => {
    const done = saved('a', 1, {
      watchLaterAt: '2026-10-21T00:00:00Z',
      watchDoneAt: '2026-10-22T00:00:00Z',
    });
    const pending = saved('b', 1, { watchLaterAt: '2026-10-21T00:00:00Z' });

    expect(savedMenuActions(done, 'all')[1]).toMatchObject({ label: 'Просмотрено', checked: true });
    expect(savedMenuActions(pending, 'all')[1]).toMatchObject({
      label: 'Не просмотрено',
      checked: false,
    });
  });

  it('no «Копировать» without text, «Открепить» when pinned', () => {
    const ids = savedMenuActions(
      saved('a', 1, { text: null, pinnedAt: '2026-10-21T00:00:00Z' }),
      'all',
    ).map((action) => action.id);

    expect(ids).not.toContain('copy');
    expect(ids).toContain('unpin');
  });
});

describe('notes in the menu', () => {
  const note = (overrides: Partial<SavedMessage> = {}) =>
    saved('n', 1, {
      sourceType: 'note',
      category: 'note',
      sourceChatId: null,
      sourceMessageId: null,
      ...overrides,
    });

  it('a note has «Изменить»; a saved copy never does', () => {
    expect(savedMenuActions(note(), 'all').map((action) => action.id)).toEqual([
      'reply',
      'watch_later',
      'copy',
      'edit',
      'select',
      'pin',
      'forward',
      'delete',
    ]);
    expect(savedMenuActions(saved('a', 1), 'all').map((action) => action.id)).not.toContain('edit');
    expect(
      savedMenuActions(note({ kind: 'voice', text: null }), 'all').map((a) => a.id),
    ).not.toContain('edit');
  });

  it('an unsent note offers only «Повторить» (when failed) and «Удалить»', () => {
    const failed = { ...note(), localId: 'local-1', status: 'failed' as const };
    const sending = { ...note(), localId: 'local-2', status: 'sending' as const };

    expect(savedMenuActions(failed, 'all').map((action) => action.id)).toEqual(['retry', 'delete']);
    expect(savedMenuActions(sending, 'all').map((action) => action.id)).toEqual(['delete']);
  });

  it('a note is signed «Вы» with my avatar', () => {
    expect(
      savedSourceLabel(note({ authorName: 'Я', authorAvatarUrl: 'me/a.jpg' }), undefined, 'me'),
    ).toEqual({ source: 'Вы', author: null, avatarUrl: 'me/a.jpg', avatarName: 'Я' });
  });

  it('quotes: a deleted one becomes a stub, a live one is signed by its source', () => {
    const quotes = savedQuotesOf(
      note({
        replies: [
          { savedId: null },
          {
            savedId: 'q',
            seq: 7,
            sourceType: 'note',
            sourceChatId: null,
            category: 'note',
            kind: 'text',
            text: 'старое',
            attachments: [],
          },
        ],
      }),
      new Map(),
      'me',
    );

    expect(quotes[0]).toMatchObject({ state: 'deleted' });
    expect(quotes[1]).toMatchObject({ state: 'live', messageId: 'q', seq: 7, authorName: 'Вы' });
  });
});

describe('savedForwardBatches', () => {
  it('notes go as my messages in screen order, between islands', () => {
    const fromG = original({
      id: 'm-1',
      chat: { id: 'chat-g', name: 'Группа', readUpTo: null, amMember: true, isChannelPosts: false },
    });
    const asNote = (id: string, seq: number) =>
      saved(id, seq, { sourceType: 'note', category: 'note', sourceChatId: null, text: id });

    expect(
      savedForwardBatches(
        [asNote('n1', 1), saved('s1', 2), asNote('n2', 3), asNote('n3', 4)],
        new Map([['s1', { messageId: 'm-1', commentId: null }]]),
        new Map([[fromG.id, fromG]]),
        new Map(),
      ),
    ).toEqual([
      { notes: [{ savedId: 'n1', kind: 'post', text: 'n1', attachments: [] }] },
      { sourceChat: { id: 'chat-g', name: 'Группа' }, items: [{ original: fromG }] },
      {
        notes: [
          { savedId: 'n2', kind: 'post', text: 'n2', attachments: [] },
          { savedId: 'n3', kind: 'post', text: 'n3', attachments: [] },
        ],
      },
    ]);
  });

  it('one island per source chat where it first appears on screen, in chat order inside, comments as one batch, gone ones skipped', () => {
    const fromG1 = original({
      id: 'm-1',
      seq: 20,
      chat: { id: 'chat-g', name: 'Группа', readUpTo: null, amMember: true, isChannelPosts: false },
    });
    const fromG2 = original({
      id: 'm-2',
      seq: 10,
      chat: { id: 'chat-g', name: 'Группа', readUpTo: null, amMember: true, isChannelPosts: false },
    });
    const fromD = original({
      id: 'm-3',
      chat: { id: 'chat-d', name: 'Личка', readUpTo: null, amMember: true, isChannelPosts: false },
    });
    const comment = { id: 'c-1' } as ForwardedComment;
    const items = [
      saved('s1', 1),
      saved('s2', 2),
      saved('s3', 3),
      saved('s4', 4),
      saved('gone', 5),
    ];
    const live = new Map([
      ['s1', { messageId: 'm-1', commentId: null }],
      ['s2', { messageId: null, commentId: 'c-1' }],
      ['s3', { messageId: 'm-3', commentId: null }],
      ['s4', { messageId: 'm-2', commentId: null }],
    ]);

    expect(
      savedForwardBatches(
        items,
        live,
        new Map([fromG1, fromG2, fromD].map((item) => [item.id, item])),
        new Map([[comment.id, comment]]),
      ),
    ).toEqual([
      {
        sourceChat: { id: 'chat-g', name: 'Группа' },
        // Сохраняли #20 раньше #10 — в островке они как в чате.
        items: [{ original: fromG2 }, { original: fromG1 }],
      },
      { comments: [comment] },
      { sourceChat: { id: 'chat-d', name: 'Личка' }, items: [{ original: fromD }] },
    ]);
  });
});

describe('forwardNotice', () => {
  it('says how many were not forwarded', () => {
    expect(forwardNotice(1, false, 2, 5)).toBe('Переслано 3 из 5: оригиналы двух удалены');
    expect(forwardNotice(1, false, 1, 3)).toBe('Переслано 2 из 3: оригинал одного удалён');
    expect(forwardNotice(1, false, 7, 9)).toBe('Переслано 2 из 9: оригиналы 7 удалены');
    expect(forwardNotice(1, false)).toBe('Переслано');
  });
});

describe('formatDayMonth', () => {
  it('«06.11» this year, «06.11.25» before', () => {
    const now = new Date(2026, 9, 24);

    expect(formatDayMonth(new Date(2026, 10, 6, 12).toISOString(), now)).toBe('06.11');
    expect(formatDayMonth(new Date(2025, 10, 6, 12).toISOString(), now)).toBe('06.11.25');
  });
});
