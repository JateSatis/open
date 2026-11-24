import { requestClient } from '@/api/requestClient';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PopEditor } from '.';

import { readChatDraft, resetComposerDrafts } from '@/features/chats/composerDraftStore';
import type { GalleryFilter, MediaLibraryItem } from '@/features/media';
import { readVideoFrame } from '@/features/media';
import { publishNewPop } from '@/features/pops/publishing';

const mockBack = jest.fn();
let mockOnPick: ((asset: MediaLibraryItem) => void) | null = null;
let mockFilter: GalleryFilter | null = null;

let mockPageParams: Record<string, unknown>;
jest.mock('@/navigation', () => ({
  useRouteParams: () => (mockPageParams), useRouter: () => ({ back: mockBack }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({}), VideoView: () => null }));
jest.mock('@/features/auth/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'me' } } }),
}));
jest.mock('@/features/channels/useChannel', () => ({
  useChannel: () => ({ data: { id: 'channel-1', postsChatId: 'posts-1' } }),
}));
jest.mock('@/features/pops/publishing', () => ({ publishNewPop: jest.fn() }));
jest.mock('@/features/chats/MediaPickerSheet', () => ({
  armMediaSheet: jest.fn(),
  openMediaSheet: jest.fn(),
  releaseMediaSheetArm: jest.fn(),
  MediaPickSheet: ({
    filter,
    onPick,
  }: {
    filter: GalleryFilter;
    onPick: (asset: MediaLibraryItem) => void;
  }) => {
    mockFilter = filter;
    mockOnPick = onPick;
    return null;
  },
}));
jest.mock('@/features/media', () => ({
  MediaLimits: { pop: { maxDurationMs: 90_000, maxCaptionLength: 300, maxTitleLength: 80 } },
  readVideoFrame: jest.fn(),
  resolveLibraryAsset: jest.fn((asset) => Promise.resolve({ ...asset, uri: 'file:///v.mp4' })),
  libraryAssetToLocalMedia: jest.fn((asset) => ({
    kind: 'video',
    uri: asset.uri,
    mimeType: 'video/mp4',
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  })),
}));

const video: MediaLibraryItem = {
  id: 'v-1',
  kind: 'video',
  width: null,
  height: null,
  durationMs: 6000,
};

async function pick(frame: { width: number; height: number }) {
  (readVideoFrame as jest.Mock).mockResolvedValue({ uri: 'file:///frame.jpg', ...frame });

  await act(async () => {
    mockOnPick!(video);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetComposerDrafts();
});

describe('PopEditor', () => {
  it('offers only videos up to 90 seconds', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'pops' };
    await render(<PopEditor />);

    expect(mockFilter).toEqual({ kind: 'video', maxDurationMs: 90_000 });
  });

  it('keeps «Опубликовать» disabled until a video is picked', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'pops' };
    await render(<PopEditor />);

    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    expect(screen.queryByLabelText('Подпись')).toBeNull();
  });

  it('rejects a horizontal video with a clear message', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'pops' };
    await render(<PopEditor />);
    await pick({ width: 1280, height: 720 });

    expect(screen.getByText('Попсы — только вертикальные видео')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
  });

  it('rejects a video whose length is unknown', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'pops' };
    await render(<PopEditor />);
    (readVideoFrame as jest.Mock).mockResolvedValue({
      uri: 'file:///frame.jpg',
      width: 720,
      height: 1280,
    });

    await act(async () => {
      mockOnPick!({ ...video, durationMs: null });
    });

    expect(screen.getByText('Не удалось узнать длительность видео. Выберите другое.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
  });

  it('publishes a vertical video with a caption, «в посты» on by default', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'pops' };
    await render(<PopEditor />);
    await pick({ width: 720, height: 1280 });

    expect(screen.getByRole('checkbox', { name: 'Опубликовать в посты' })).toBeChecked();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Название'), ' Ёлка ');
      fireEvent.changeText(screen.getByLabelText('Подпись'), ' тест ');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Опубликовать' }));
    });

    expect(publishNewPop).toHaveBeenCalledWith(
      {},
      'me',
      expect.objectContaining({
        channelId: 'channel-1',
        title: 'Ёлка',
        caption: 'тест',
        alsoPost: true,
        posterUri: 'file:///frame.jpg',
        media: expect.objectContaining({ uri: 'file:///v.mp4', width: 720, height: 1280 }),
      }),
      requestClient(),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it('does not publish without a title and says why', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'pops' };
    await render(<PopEditor />);
    await pick({ width: 720, height: 1280 });

    expect(screen.queryByTestId('pop-title-required')).toBeNull();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Название'), '   ');
      fireEvent.press(screen.getByRole('button', { name: 'Опубликовать' }));
    });

    expect(publishNewPop).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByText('Добавьте название — без него поп не опубликовать')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Название'), 'Ёлка');
    });

    expect(screen.queryByTestId('pop-title-required')).toBeNull();
  });

  it('from «Посты» asks for a title, then hands the video to the posts draft', async () => {
    mockPageParams = { channelId: 'channel-1', from: 'posts' };
    await render(<PopEditor />);

    expect(screen.queryByRole('button', { name: 'Опубликовать' })).toBeNull();

    await pick({ width: 720, height: 1280 });

    // Подписи и галочки нет: текст у поста.
    expect(screen.queryByLabelText('Подпись')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Готово' }));
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(readChatDraft('posts-1').pop).toBeFalsy();
    expect(screen.getByTestId('pop-title-required')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Название'), ' Ёлка ');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Готово' }));
    });

    expect(readChatDraft('posts-1').pop).toMatchObject({
      type: 'new',
      title: 'Ёлка',
      uri: 'file:///v.mp4',
      posterUri: 'file:///frame.jpg',
    });
    expect(mockBack).toHaveBeenCalled();
    expect(publishNewPop).not.toHaveBeenCalled();
  });
});
