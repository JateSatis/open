import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { PopsSection } from '.';

import { canPublishInChannel, listPops, publishPop, type Pop } from '@/api/pops';
import { resetPendingPops } from '@/features/pops/pendingPops';
import { publishNewPop } from '@/features/pops/publishing';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/features/auth/useSession', () => ({
  useSession: () => ({ session: { user: { id: 'me' } } }),
}));
jest.mock('@/features/chats/useChats', () => ({ chatsQueryKey: ['chats'] }));
const mockOpenPopViewer = jest.fn();
jest.mock('@/features/pops/openPopViewer', () => ({
  openPopViewer: (...args: unknown[]) => mockOpenPopViewer(...args),
}));
jest.mock('@/api/popTopics', () => ({ acquirePopTopic: () => () => undefined }));
jest.mock('@/api/pops', () => ({
  POPS_PAGE_SIZE: 30,
  NO_POP_REACTIONS: { counts: {}, mine: null },
  listPops: jest.fn(),
  canPublishInChannel: jest.fn(),
  publishPop: jest.fn(),
}));
jest.mock('@/features/media', () => ({
  MediaUploadError: class MediaUploadError extends Error {},
  mediaRejectionText: () => null,
  prepareForUpload: jest.fn((media) =>
    Promise.resolve({ ...media, posterUri: 'file:///poster.jpg' }),
  ),
  removePublicMedia: jest.fn(() => Promise.resolve(true)),
  storedPaths: (media: { path: string }) => [media.path],
  uploadPopMedia: jest.fn((media) =>
    Promise.resolve({
      ...media,
      url: 'https://cdn/pop.mp4',
      path: 'me/pops/x.mp4',
      posterUrl: 'https://cdn/pop.jpg',
      posterPath: 'me/pops/x.jpg',
      sizeBytes: 10,
      waveform: null,
    }),
  ),
}));

const pop: Pop = {
  id: 'pop-1',
  channelId: 'channel-1',
  authorId: 'me',
  title: 'Поп',
  caption: null,
  url: 'https://cdn/1.mp4',
  posterUrl: 'https://cdn/1.jpg',
  mimeType: 'video/mp4',
  width: 720,
  height: 1280,
  durationMs: 5000,
  createdAt: '2026-10-08T10:00:00Z',
  reactions: { counts: {}, mine: null },
  viewsCount: 0,
  commentsCount: 0,
};

const probe: { client: QueryClient | null } = { client: null };

/** Достаёт клиент запросов теста — публикация пишет в его кеш. */
function ClientProbe() {
  const client = useQueryClient();

  useEffect(() => {
    probe.client = client;
  }, [client]);

  return null;
}

async function renderSection() {
  await renderWithQuery(
    <>
      <ClientProbe />
      <PopsSection channelId="channel-1" />
    </>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPendingPops();
  (listPops as jest.Mock).mockResolvedValue([]);
});

describe('PopsSection', () => {
  it('shows only the «+» tile to a publisher of an empty channel', async () => {
    (canPublishInChannel as jest.Mock).mockResolvedValue(true);

    await renderSection();

    expect(await screen.findByLabelText('Новый поп')).toBeTruthy();
    expect(screen.queryByText('Попсов пока нет')).toBeNull();

    fireEvent.press(screen.getByLabelText('Новый поп'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/pop-editor/[channelId]',
      params: { channelId: 'channel-1', from: 'pops' },
    });
  });

  it('shows a stranger the empty state and no «+»', async () => {
    (canPublishInChannel as jest.Mock).mockResolvedValue(false);

    await renderSection();

    expect(await screen.findByText('Попсов пока нет')).toBeTruthy();
    expect(screen.queryByLabelText('Новый поп')).toBeNull();
  });

  it('shows a stranger published pops with views; a tap opens the viewer on that pop', async () => {
    (canPublishInChannel as jest.Mock).mockResolvedValue(false);
    (listPops as jest.Mock).mockResolvedValue([{ ...pop, viewsCount: 1234 }]);

    await renderSection();

    fireEvent.press(await screen.findByTestId('pop-tile'));

    expect(screen.getByLabelText('Просмотры: 1234')).toBeTruthy();
    expect(screen.getByText('1,2K')).toBeTruthy();
    expect(mockOpenPopViewer).toHaveBeenCalledWith('channel-1', 'pop-1', { entry: 'channel_grid' });
  });

  it('puts a publishing pop first, marks a failure and retries with the same id', async () => {
    (canPublishInChannel as jest.Mock).mockResolvedValue(true);
    (publishPop as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));

    await renderSection();

    await screen.findByLabelText('Новый поп');

    await act(async () => {
      publishNewPop(probe.client!, 'me', {
        channelId: 'channel-1',
        media: {
          kind: 'video',
          uri: 'file:///v.mp4',
          mimeType: 'video/mp4',
          width: 720,
          height: 1280,
          durationMs: 5000,
        },
        posterUri: 'file:///frame.jpg',
        title: 'Поп',
        caption: 'тест',
        alsoPost: true,
      });
    });

    expect(await screen.findByLabelText('Не опубликовано. Повторить')).toBeTruthy();

    const [first] = (publishPop as jest.Mock).mock.calls[0];

    expect(first).toMatchObject({ caption: 'тест', alsoPost: true, postText: 'тест' });

    (publishPop as jest.Mock).mockResolvedValueOnce({ popId: first.popId, messageId: 'm-1' });
    // Перечитанная после публикации страница уже знает о попе.
    (listPops as jest.Mock).mockResolvedValue([{ ...pop, id: first.popId }]);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Не опубликовано. Повторить'));
    });

    await waitFor(() => expect(screen.queryByTestId('pop-pending-tile')).toBeNull());
    expect((publishPop as jest.Mock).mock.calls[1][0].popId).toBe(first.popId);
    expect(screen.getByTestId('pop-tile')).toBeTruthy();
  });
});
