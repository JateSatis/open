import { act, renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import {
  exitFragmentMode,
  getFragmentState,
  setTextSelection,
  type TextSelection,
} from './fragmentStore';
import { useFragmentMode } from './useFragmentMode';

import type { BubbleRow } from '@/features/chats/islands/rows';
import type { ChatMessage } from '@/features/chats/messages/types';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'какой-то другой уровень',
    createdAt: '2026-10-14T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
    ...overrides,
  } as ChatMessage;
}

const row = (id: string, overrides?: Partial<ChatMessage>): BubbleRow =>
  ({ type: 'message', key: id, message: message(id, overrides) }) as BubbleRow;

function selectionIn(rowKey: string): TextSelection {
  return {
    rowKey,
    messageId: rowKey,
    chatId: 'chat-1',
    amMember: false,
    text: 'какой-то другой уровень',
    start: 0,
    end: 8,
    geometry: { text: '', width: 100, height: 20, lines: [], xs: [] },
    textInRow: { x: 0, y: 0 },
    textInWindow: { x: 0, y: 0 },
    dragging: null,
  };
}

let backHandler: Parameters<typeof BackHandler.addEventListener>[1] | null = null;

beforeEach(() => {
  exitFragmentMode();
  backHandler = null;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandler = handler;
    return { remove: () => undefined };
  });
});

function render(options: { isMember?: boolean; isFocused?: boolean; isSelecting?: boolean } = {}) {
  return renderHook(
    (props: { isMember: boolean; isFocused: boolean; isSelecting: boolean }) =>
      useFragmentMode(props),
    {
      initialProps: { isMember: false, isFocused: true, isSelecting: false, ...options },
    },
  );
}

describe('fragment mode', () => {
  it('a viewer enters it with a tap and leaves it with a second tap', async () => {
    const { result } = await render();

    await act(async () => result.current.pressRow(row('m1')));
    expect(getFragmentState().activeKey).toBe('m1');

    await act(async () => result.current.pressRow(row('m1')));
    expect(getFragmentState().activeKey).toBeNull();
  });

  it('keeps one message in the mode: a tap on another moves it there', async () => {
    const { result } = await render();

    await act(async () => result.current.pressRow(row('m1')));
    await act(async () => result.current.pressRow(row('m2')));

    expect(getFragmentState().activeKey).toBe('m2');
  });

  it('lets a member of the chat (and a publisher of the channel) in nowhere yet', async () => {
    const { result } = await render({ isMember: true });

    await act(async () => result.current.pressRow(row('m1')));

    expect(getFragmentState().activeKey).toBeNull();
  });

  it('does nothing on a photo without a caption, a system line or an unsent message', async () => {
    const { result } = await render();

    await act(async () => result.current.pressRow(row('m1', { kind: 'media', text: null })));
    await act(async () => result.current.pressRow(row('m2', { kind: 'system' })));
    await act(async () => result.current.pressRow(row('m3', { status: 'failed' })));

    expect(getFragmentState().activeKey).toBeNull();
  });

  it('judges an island bubble by the membership in the original’s chat', async () => {
    const { result } = await render({ isMember: true });
    const island = {
      type: 'island-item',
      key: 'isl/o1',
      island: message('isl', { kind: 'forward', authorId: 'user-1' }),
      item: { messageId: 'o1', original: { ...message('o1'), chat: { amMember: false } } },
      isLast: true,
    } as unknown as BubbleRow;

    await act(async () => result.current.pressRow(island));

    expect(getFragmentState().activeKey).toBe('isl/o1');
  });

  it('a tap on the message with a selection only drops the selection', async () => {
    const { result } = await render();

    await act(async () => result.current.pressRow(row('m1')));
    await act(async () => setTextSelection(selectionIn('m1')));
    await act(async () => result.current.pressRow(row('m1')));

    expect(getFragmentState()).toEqual({ activeKey: 'm1', selection: null, quote: null });
  });

  it('system back drops the selection first, then leaves the mode', async () => {
    const { result } = await render();

    await act(async () => result.current.pressRow(row('m1')));
    await act(async () => setTextSelection(selectionIn('m1')));

    await act(async () => void backHandler?.({} as never));
    expect(getFragmentState()).toEqual({ activeKey: 'm1', selection: null, quote: null });

    await act(async () => void backHandler?.({} as never));
    expect(getFragmentState().activeKey).toBeNull();
  });

  it('turns off when selection of messages starts and when the screen loses focus', async () => {
    const { result, rerender } = await render();

    await act(async () => result.current.pressRow(row('m1')));
    await rerender({ isMember: false, isFocused: true, isSelecting: true });
    expect(getFragmentState().activeKey).toBeNull();

    await rerender({ isMember: false, isFocused: true, isSelecting: false });
    await act(async () => result.current.pressRow(row('m1')));
    await rerender({ isMember: false, isFocused: false, isSelecting: false });
    expect(getFragmentState().activeKey).toBeNull();
  });

  it('a long press starts a selection only in the message that is in the mode', async () => {
    const { result } = await render();
    const point = { x: 10, y: 10, localX: 10, localY: 10 };

    expect(result.current.longPressAt('m1', point)).toBe(false);
  });
});
