import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { PopViewer } from '.';

import {
  canPublishInChannel,
  getPop,
  listPops,
  listPopsAfter,
  recordPopViews,
  type Pop,
} from '@/api/pops';
import { setPopReaction } from '@/api/reactions';
import { resetPendingReactions } from '@/features/interactions/pendingReactions';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: 'pops' }] }),
  }),
}));
jest.mock('expo-video', () => {
  const { View } = require('react-native');

  return {
    useVideoPlayer: () => ({
      play: jest.fn(),
      pause: jest.fn(),
      addListener: () => ({ remove: jest.fn() }),
    }),
    VideoView: (props: object) => <View {...props} />,
  };
});
// Анимация сердца — Reanimated; в моке она завершается сразу, и сердце
// исчезало бы до проверки. Здесь важно, что оно появилось в точке тапа.
jest.mock('./HeartBurst', () => {
  const { View } = require('react-native');

  return {
    HEART: '❤️',
    randomTilt: () => 0,
    HeartBurst: () => <View testID="pop-heart" />,
  };
});
jest.mock('@/api/pops', () => ({
  getPop: jest.fn(),
  listPops: jest.fn(),
  listPopsAfter: jest.fn(),
  listPopCounters: jest.fn(() => Promise.resolve([])),
  recordPopViews: jest.fn(() => Promise.resolve()),
  canPublishInChannel: jest.fn(),
  POPS_PAGE_SIZE: 30,
}));
jest.mock('@/api/reactions', () => ({ setPopReaction: jest.fn() }));
jest.mock('@/api/comments', () => ({ setCommentReaction: jest.fn() }));
jest.mock('@/api/popTopics', () => ({ acquirePopTopic: () => () => undefined }));
jest.mock('@/api/channels', () => ({
  getChannel: jest.fn(() => Promise.resolve({ id: 'channel-1', title: 'Канал A' })),
}));

function pop(id: string, extra: Partial<Pop> = {}): Pop {
  return {
    id,
    channelId: 'channel-1',
    authorId: 'author',
    caption: `Подпись ${id}`,
    url: `https://cdn/${id}.mp4`,
    posterUrl: `https://cdn/${id}.jpg`,
    mimeType: 'video/mp4',
    width: 720,
    height: 1280,
    durationMs: 6000,
    createdAt: '2026-10-10T10:00:00Z',
    reactions: { counts: {}, mine: null },
    viewsCount: 0,
    ...extra,
  };
}

async function open(start: Pop, { canPublish = false } = {}) {
  (getPop as jest.Mock).mockResolvedValue(start);
  (listPopsAfter as jest.Mock).mockResolvedValue([]);
  (listPops as jest.Mock).mockResolvedValue([]);
  (canPublishInChannel as jest.Mock).mockResolvedValue(canPublish);

  await renderWithQuery(<PopViewer channelId="channel-1" startId={start.id} />);
  await fireEvent(screen.getByTestId('pop-viewer'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 800 } },
  });

  await screen.findByTestId('pop-page-active');
}

/** Двойной тап — два нажатия подряд, без паузы между ними. */
async function doubleTap() {
  const surface = screen.getByTestId('pop-surface');
  const touch = { nativeEvent: { locationX: 100, locationY: 200 } };

  await fireEvent.press(surface, touch);
  await fireEvent.press(surface, touch);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPendingReactions();
  (setPopReaction as jest.Mock).mockImplementation((_id: string, emoji: string | null) =>
    Promise.resolve(emoji ? { emoji, audience: 'visitor' } : null),
  );
});

describe('PopViewer', () => {
  it('shows the pop with the channel name, its caption and the side column', async () => {
    await open(pop('p1'));

    expect(await screen.findByText('Канал A')).toBeTruthy();
    expect(screen.getByText('Подпись p1')).toBeTruthy();
    expect(screen.getByTestId('pop-add-reaction')).toBeTruthy();
    expect(screen.getByTestId('pop-comments')).toBeTruthy();
    expect(screen.getByLabelText('Просмотры: 0')).toBeTruthy();
    expect(screen.getByTestId('pop-more')).toBeTruthy();
  });

  it('a stranger reacts from «+»: the reaction shows at once and goes to the server', async () => {
    await open(pop('p1'));

    await fireEvent.press(screen.getByTestId('pop-add-reaction'));
    await fireEvent.press(await screen.findByTestId('reaction-option-🔥'));

    expect(await screen.findByTestId('reaction-chip-🔥')).toBeTruthy();
    await waitFor(() => expect(setPopReaction).toHaveBeenCalledWith('p1', '🔥'));
  });

  it('tap on my reaction in the column takes it off', async () => {
    await open(pop('p1', { reactions: { counts: { '🔥': 1 }, mine: '🔥' } }));

    await fireEvent.press(screen.getByTestId('reaction-chip-🔥'));

    await waitFor(() => expect(setPopReaction).toHaveBeenCalledWith('p1', null));
    expect(screen.queryByTestId('reaction-chip-🔥')).toBeNull();
  });

  it('double tap puts ❤️ when I have no reaction, and a heart appears', async () => {
    await open(pop('p1'));

    await doubleTap();

    expect(screen.getByTestId('pop-heart')).toBeTruthy();
    expect(await screen.findByTestId('reaction-chip-❤️')).toBeTruthy();
    await waitFor(() => expect(setPopReaction).toHaveBeenCalledWith('p1', '❤️'));
  });

  it('double tap over another reaction of mine only animates — the reaction stays', async () => {
    await open(pop('p1', { reactions: { counts: { '😁': 1 }, mine: '😁' } }));

    await doubleTap();

    expect(screen.getByTestId('pop-heart')).toBeTruthy();
    expect(setPopReaction).not.toHaveBeenCalled();
    expect(screen.getByTestId('reaction-chip-😁')).toBeTruthy();
  });

  it('a single tap pauses after the double-tap window; another resumes', async () => {
    jest.useFakeTimers();
    await open(pop('p1'));

    await fireEvent.press(screen.getByTestId('pop-surface'), {
      nativeEvent: { locationX: 0, locationY: 0 },
    });
    expect(screen.queryByTestId('pop-paused')).toBeNull();

    await act(() => jest.advanceTimersByTime(300));
    expect(screen.getByTestId('pop-paused')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('pop-surface'), {
      nativeEvent: { locationX: 0, locationY: 0 },
    });
    await act(() => jest.advanceTimersByTime(300));
    expect(screen.queryByTestId('pop-paused')).toBeNull();
    jest.useRealTimers();
  });

  it('comments and «⋯» are indicators: a tap does nothing', async () => {
    await open(pop('p1'));

    await fireEvent.press(screen.getByTestId('pop-comments'));
    await fireEvent.press(screen.getByTestId('pop-more'));

    expect(screen.queryByTestId('pop-paused')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('counts a view for a stranger as soon as the pop is shown', async () => {
    jest.useFakeTimers();
    await open(pop('p1'));
    await act(() => jest.advanceTimersByTime(2500));
    expect(recordPopViews).toHaveBeenCalledWith(['p1'], expect.any(String));
    jest.useRealTimers();
  });

  it('the publisher’s own views are not sent', async () => {
    jest.useFakeTimers();
    await open(pop('p1'), { canPublish: true });
    await act(() => jest.advanceTimersByTime(2500));
    expect(recordPopViews).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('the back arrow leaves the viewer', async () => {
    await open(pop('p1'));

    await fireEvent.press(screen.getByTestId('pop-viewer-back'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('a deleted start pop says so', async () => {
    (getPop as jest.Mock).mockResolvedValue(null);
    (canPublishInChannel as jest.Mock).mockResolvedValue(false);

    await renderWithQuery(<PopViewer channelId="channel-1" startId="gone" />);
    await fireEvent(screen.getByTestId('pop-viewer'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 800 } },
    });

    expect(await screen.findByText('Поп удалён')).toBeTruthy();
  });
});
