import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useComposerDraft } from './useComposerDraft';

jest.mock('@/features/media', () => ({
  MediaLimits: { gallery: { maxSelection: 2, pageSize: 30 } },
  loadAssetUri: jest.fn((id: string) => Promise.resolve(`file://${id}.jpg`)),
}));

function asset(id: string) {
  return { id, kind: 'photo' as const, uri: `file://${id}.jpg`, width: 100, height: 100, durationMs: null };
}

describe('useComposerDraft', () => {
  it('selects media in tap order and numbers them accordingly', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.toggleMedia(asset('b')));
    await act(() => result.current.toggleMedia(asset('a')));

    expect(result.current.media.map((item) => item.id)).toEqual(['b', 'a']);
    expect(result.current.selectionOrder('b')).toBe(1);
    expect(result.current.selectionOrder('a')).toBe(2);
    expect(result.current.selectionOrder('c')).toBeNull();
  });

  it('accepts a file without a path yet and fills it in afterwards', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.toggleMedia({ ...asset('a'), uri: null }));

    // Выбран сразу, не дожидаясь файловой системы.
    expect(result.current.media.map((item) => item.id)).toEqual(['a']);

    await waitFor(() => expect(result.current.media[0].uri).toBe('file://a.jpg'));
  });

  it('removes a file from the selection when toggled again', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.toggleMedia(asset('a')));
    await act(() => result.current.toggleMedia(asset('a')));

    expect(result.current.media).toEqual([]);
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('removeMedia drops a file the same way the strip does', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.toggleMedia(asset('a')));
    await act(() => result.current.toggleMedia(asset('b')));
    await act(() => result.current.removeMedia('a'));

    expect(result.current.media.map((item) => item.id)).toEqual(['b']);
  });

  it('stops accepting new files once the product limit is reached', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.toggleMedia(asset('a')));
    await act(() => result.current.toggleMedia(asset('b')));

    expect(result.current.isFull).toBe(true);

    await act(() => result.current.toggleMedia(asset('c')));

    expect(result.current.media.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('clears both text and media', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.setText('привет'));
    await act(() => result.current.toggleMedia(asset('a')));
    await act(() => result.current.clear());

    expect(result.current.text).toBe('');
    expect(result.current.media).toEqual([]);
  });

  it('clears only the media, keeping the text', async () => {
    const { result } = await renderHook(() => useComposerDraft('chat-1'));

    await act(() => result.current.setText('привет'));
    await act(() => result.current.toggleMedia(asset('a')));
    await act(() => result.current.clearMedia());

    expect(result.current.text).toBe('привет');
    expect(result.current.media).toEqual([]);
  });

  it('discards the draft when the chat changes', async () => {
    const { result, rerender } = await renderHook(
      ({ chatId }: { chatId: string }) => useComposerDraft(chatId),
      { initialProps: { chatId: 'chat-1' } },
    );

    await act(() => result.current.setText('черновик'));
    await act(() => result.current.toggleMedia(asset('a')));

    await rerender({ chatId: 'chat-2' });

    expect(result.current.text).toBe('');
    expect(result.current.media).toEqual([]);
  });
});
