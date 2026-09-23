import { act, renderHook } from '@testing-library/react-native';

import { useComposerDraft } from './useComposerDraft';

import { useMediaSelection } from '@/features/media/selectionStore';

jest.mock('@/features/media', () => jest.requireActual('@/features/media/selectionStore'));
jest.mock('@/features/media/constants', () => ({
  MediaLimits: { gallery: { maxSelection: 2 } },
}));

function asset(id: string) {
  return { id, kind: 'photo' as const, width: 100, height: 100, durationMs: null };
}

const select = (id: string) => useMediaSelection.getState().toggle(asset(id));

beforeEach(() => {
  useMediaSelection.getState().clear();
});

describe('useComposerDraft', () => {
  it('reads the selection out of the store, in tap order', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => {
      select('b');
      select('a');
    });

    expect(result.current.media().map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('removes a file from the selection when toggled again', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => {
      select('a');
      select('a');
    });

    expect(result.current.media()).toEqual([]);
  });

  it('stops accepting new files once the product limit is reached', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => {
      select('a');
      select('b');
      select('c');
    });

    expect(result.current.media().map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('clears both text and media', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => {
      result.current.setText('привет');
      select('a');
    });
    await act(() => result.current.clear());

    expect(result.current.text).toBe('');
    expect(result.current.media()).toEqual([]);
  });

  it('clears only the media, keeping the text', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => {
      result.current.setText('привет');
      select('a');
    });
    await act(() => result.current.clearMedia());

    expect(result.current.text).toBe('привет');
    expect(result.current.media()).toEqual([]);
  });

  it('discards the draft when the chat changes', async () => {
    const { result, rerender } = await renderHook((chatId: string) => useComposerDraft(chatId), {
      initialProps: 'chat-1',
    });

    await act(() => {
      result.current.setText('привет');
      select('a');
    });
    await rerender('chat-2');

    expect(result.current.text).toBe('');
    expect(result.current.media()).toEqual([]);
  });
});
