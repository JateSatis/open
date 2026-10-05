import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type ViewToken } from 'react-native';

import { useMessageViews, viewedMessageOf } from './useMessageViews';

import { recordMessageViews } from '@/api/messageViews';
import { toChatRows, type ChatListRow } from '@/features/chats/islands/rows';
import type { ChatMessage } from '@/features/chats/messages/types';
import { island, original } from '@/test/islands';

jest.mock('@/api/messageViews', () => ({ recordMessageViews: jest.fn() }));

const record = recordMessageViews as jest.Mock;

function message(id: string, authorId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: 'text',
    text: id,
    createdAt: '2026-10-05T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
    ...extra,
  };
}

const tokens = (rows: ChatListRow[]) =>
  rows.map((item, index) => ({ item, key: item.key, index, isViewable: true }) as ViewToken<ChatListRow>);

function options(extra: Partial<Parameters<typeof useMessageViews>[0]> = {}) {
  return {
    chatId: 'chat-1',
    currentUserId: 'me',
    isFocused: true,
    rows: [] as ChatListRow[],
    autoscrollThreshold: 64,
    ...extra,
  };
}

const scrolledTo = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as Parameters<
    ReturnType<typeof useMessageViews>['onScroll']
  >[0];

let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  record.mockReset();
  record.mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('viewedMessageOf', () => {
  it('чужое отправленное сообщение засчитывается в свой чат', () => {
    const [row] = toChatRows([message('m1', 'other')]);

    expect(viewedMessageOf(row, 'me')).toEqual({ id: 'm1', chatId: 'chat-1' });
  });

  it('своё и неотправленное — нет', () => {
    const [own] = toChatRows([message('m1', 'me')]);
    const [sending] = toChatRows([message('local-1', 'other', { status: 'sending' })]);

    expect(viewedMessageOf(own, 'me')).toBeNull();
    expect(viewedMessageOf(sending, 'me')).toBeNull();
  });

  it('облачко островка засчитывает оригинал в его чат, плашка — ничего', () => {
    const rows = toChatRows([
      { ...island('f1', '2026-10-05T10:00:00Z', [original({ id: 'o1' })]), status: 'sent' },
    ]);
    const item = rows.find((row) => row.type === 'island-item')!;
    const header = rows.find((row) => row.type === 'island-header')!;

    expect(viewedMessageOf(item, 'me')).toEqual({ id: 'o1', chatId: 'chat-src' });
    expect(viewedMessageOf(header, 'me')).toBeNull();
  });
});

describe('useMessageViews', () => {
  it('копит показанное и отправляет пачкой, каждое — раз за сессию', async () => {
    const { result } = await renderHook(() => useMessageViews(options()));
    const rows = toChatRows([message('m2', 'other'), message('m1', 'other')]);

    await act(() => result.current.onViewableItemsChanged({ viewableItems: tokens(rows) }));
    // Уехало за край и вернулось — не новый просмотр.
    await act(() => result.current.onViewableItemsChanged({ viewableItems: [] }));
    await act(() => result.current.onViewableItemsChanged({ viewableItems: tokens(rows) }));

    expect(record).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTime(2000));

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('chat-1', ['m2', 'm1'], expect.any(String));

    await act(() => result.current.onViewableItemsChanged({ viewableItems: tokens(rows) }));
    await act(() => jest.advanceTimersByTime(5000));

    expect(record).toHaveBeenCalledTimes(1);
  });

  it('оригиналы островка уходят вызовом на чат оригинала', async () => {
    const { result } = await renderHook(() => useMessageViews(options()));
    const rows = toChatRows([
      message('m1', 'other'),
      { ...island('f1', '2026-10-05T10:00:00Z', [original({ id: 'o1' })]), status: 'sent' },
    ]);

    await act(() => result.current.onViewableItemsChanged({ viewableItems: tokens(rows) }));
    await act(() => jest.advanceTimersByTime(2000));

    expect(record).toHaveBeenCalledWith('chat-1', ['m1'], expect.any(String));
    expect(record).toHaveBeenCalledWith('chat-src', ['o1'], expect.any(String));
  });

  it('уход с экрана отправляет сразу, новый вход — новая сессия', async () => {
    const first = await renderHook(() => useMessageViews(options()));

    await act(() =>
      first.result.current.onViewableItemsChanged({
        viewableItems: tokens(toChatRows([message('m1', 'other')])),
      }),
    );
    await first.unmount();

    expect(record).toHaveBeenCalledTimes(1);
    const firstSession = record.mock.calls[0][2];

    const second = await renderHook(() => useMessageViews(options()));

    await act(() =>
      second.result.current.onViewableItemsChanged({
        viewableItems: tokens(toChatRows([message('m1', 'other')])),
      }),
    );
    await second.unmount();

    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1][2]).not.toBe(firstSession);
  });

  it('в фоне не засчитывает, а по возвращении засчитывает то, что на экране', async () => {
    const { result } = await renderHook(() => useMessageViews(options()));

    await act(() => appStateListener?.('background'));
    await act(() =>
      result.current.onViewableItemsChanged({
        viewableItems: tokens(toChatRows([message('new', 'other')])),
      }),
    );
    await act(() => jest.advanceTimersByTime(5000));

    expect(record).not.toHaveBeenCalled();

    await act(() => appStateListener?.('active'));
    await act(() => jest.advanceTimersByTime(2000));

    expect(record).toHaveBeenCalledWith('chat-1', ['new'], expect.any(String));
  });

  it('пока экран чата не наверху, не засчитывает', async () => {
    const { result, rerender } = await renderHook(
      ({ focused }: { focused: boolean }) => useMessageViews(options({ isFocused: focused })),
      { initialProps: { focused: false } },
    );

    await act(() =>
      result.current.onViewableItemsChanged({
        viewableItems: tokens(toChatRows([message('m1', 'other')])),
      }),
    );
    await act(() => jest.advanceTimersByTime(5000));

    expect(record).not.toHaveBeenCalled();

    await rerender({ focused: true });
    await act(() => jest.advanceTimersByTime(2000));

    expect(record).toHaveBeenCalledWith('chat-1', ['m1'], expect.any(String));
  });

  it('своё не отправляет вовсе', async () => {
    const { result } = await renderHook(() => useMessageViews(options()));

    await act(() =>
      result.current.onViewableItemsChanged({
        viewableItems: tokens(toChatRows([message('m1', 'me')])),
      }),
    );
    await act(() => jest.advanceTimersByTime(5000));

    expect(record).not.toHaveBeenCalled();
  });

  it('новое снизу у низа переписки засчитывается без события видимости', async () => {
    const old = toChatRows([message('m1', 'other')]);
    const { rerender } = await renderHook(
      ({ rows }: { rows: ChatListRow[] }) => useMessageViews(options({ rows })),
      { initialProps: { rows: old } },
    );

    await rerender({ rows: toChatRows([message('m2', 'other'), message('m1', 'other')]) });
    await act(() => jest.advanceTimersByTime(2000));

    expect(record).toHaveBeenCalledWith('chat-1', ['m2'], expect.any(String));
  });

  it('новое снизу, пока человек читает выше, не засчитывается', async () => {
    const old = toChatRows([message('m1', 'other')]);
    const { result, rerender } = await renderHook(
      ({ rows }: { rows: ChatListRow[] }) => useMessageViews(options({ rows })),
      { initialProps: { rows: old } },
    );

    await act(() => result.current.onScroll(scrolledTo(500)));
    await rerender({ rows: toChatRows([message('m2', 'other'), message('m1', 'other')]) });
    await act(() => jest.advanceTimersByTime(5000));

    expect(record).not.toHaveBeenCalled();
  });
});
