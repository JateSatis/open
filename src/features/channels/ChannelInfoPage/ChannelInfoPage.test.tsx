import * as Clipboard from 'expo-clipboard';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { getChannel, getChannelInfoSummary, type Channel } from '@/api/channels';
import { getLastSeen, listChatMedia, listChatVoices } from '@/api/chatInfo';
import { canPublishInChannel, listPops } from '@/api/pops';
import {
  getMySubscription,
  listChannelSubscribers,
  setChannelInChats,
  setChannelNotifications,
  subscribeToChannel,
  unsubscribeFromChannel,
  type ChannelSubscription,
} from '@/api/subscriptions';
import { confirm } from '@/components/ConfirmDialog/store';
import { ChannelInfoScreen } from '@/features/channels/ChannelInfoScreen';
import { useProfile } from '@/features/profile/queries';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/channels', () => ({
  getChannel: jest.fn(),
  getChannelInfoSummary: jest.fn(),
}));
jest.mock('@/api/chatInfo', () => ({
  getLastSeen: jest.fn(),
  listChatMedia: jest.fn(),
  listChatVoices: jest.fn(),
}));
jest.mock('@/api/pops', () => ({
  POPS_PAGE_SIZE: 30,
  listPops: jest.fn(),
  canPublishInChannel: jest.fn(),
}));
jest.mock('@/api/chats', () => ({ subscribeToChatSignals: jest.fn(() => () => undefined) }));
jest.mock('@/features/profile/queries', () => ({ useProfile: jest.fn() }));
jest.mock('@/components/ConfirmDialog/store', () => ({ confirm: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

const mockPush = jest.fn();
const mockDispatch = jest.fn();

type MockRoute = { key: string; name: string; params?: object };

/** Стек «Чатов»: под страницей — экран этого канала. */
const STACK_OVER_CHANNEL = {
  index: 2,
  routes: [
    { key: 'chats', name: 'index' },
    { key: 'channel-key', name: 'Channel', params: { channelId: 'channel-1' } },
    { key: 'info-key', name: 'channel-info/[channelId]', params: { channelId: 'channel-1' } },
  ] as MockRoute[],
};
let mockStack = STACK_OVER_CHANNEL;

jest.mock('@/navigation', () => ({
  useRouteParams: () => ({ channelId: 'channel-1' }),
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => mockStack,
    dispatch: mockDispatch,
    addListener: () => () => undefined,
  }),
  useRouter: () => ({
    push: mockPush,
    navigate: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('@shopify/react-native-skia', () => ({
  Canvas: () => null,
  LinearGradient: () => null,
  Rect: () => null,
  vec: (x: number, y: number) => ({ x, y }),
  Skia: { Data: { fromURI: () => Promise.reject(new Error('нет в тестах')) } },
  AlphaType: {},
  ColorType: {},
}));

jest.mock('@/features/media', () => ({
  MediaViewer: () => null,
  VideoNotePlayer: () => null,
  formatDuration: (ms: number) => `0:${String(Math.round(ms / 1000)).padStart(2, '0')}`,
  stopVoice: jest.fn(),
}));

jest.mock('@/features/media/voicePlayback', () => ({
  toggleVoice: jest.fn(),
  useVoicePlayback: () => ({
    isActive: false,
    playing: false,
    loading: false,
    failed: false,
    positionMs: 0,
    durationMs: 0,
  }),
}));

let mockUserId = 'me';

jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => mockUserId }));

const channel: Channel = {
  id: 'channel-1',
  title: 'Новости',
  description: 'Всё о главном',
  username: 'news',
  avatarUrl: null,
  ownerId: 'owner',
  postsChatId: 'posts-1',
  subscribersCount: 12,
  readersCount: 3,
};

const subscription = (overrides: Partial<ChannelSubscription> = {}): ChannelSubscription => ({
  channelId: 'channel-1',
  chatId: 'posts-1',
  inChats: false,
  notify: true,
  unreadPosts: 0,
  unreadPops: 0,
  inChatsAt: null,
  ...overrides,
});

/** В тестах раскладки нет: карточки «меряются» вручную, и вкладки монтируются. */
async function layoutCards() {
  await fireEvent(screen.getByTestId('info-cards'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 120 } },
  });
}

async function menuItems() {
  await fireEvent.press(screen.getByTestId('info-menu-button'));

  return (await screen.findAllByRole('menuitem')).map((item) => item.props.accessibilityLabel);
}

async function renderPage() {
  await renderWithQuery(<ChannelInfoScreen />);
  await screen.findByTestId('channel-info-page');
}

/** Подписка «на сервере»: действия меняют её, перечитывание отдаёт новую. */
let serverSubscription: ChannelSubscription | null = null;

function serveSubscription(next: ChannelSubscription | null) {
  serverSubscription = next;
  jest.mocked(getMySubscription).mockImplementation(() => Promise.resolve(serverSubscription));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'me';
  mockStack = STACK_OVER_CHANNEL;
  serveSubscription(null);
  jest.mocked(getChannel).mockImplementation(() =>
    Promise.resolve({
      ...channel,
      subscribersCount: serverSubscription ? 13 : 12,
    }),
  );
  jest.mocked(subscribeToChannel).mockImplementation((_id, addToChats) => {
    serverSubscription = subscription({ inChats: Boolean(addToChats) });
    return Promise.resolve();
  });
  jest.mocked(setChannelInChats).mockImplementation((_id, inChats) => {
    if (serverSubscription) serverSubscription = { ...serverSubscription, inChats };
    return Promise.resolve();
  });
  jest.mocked(setChannelNotifications).mockImplementation((_id, notify) => {
    if (serverSubscription) serverSubscription = { ...serverSubscription, notify };
    return Promise.resolve();
  });
  jest.mocked(unsubscribeFromChannel).mockImplementation(() => {
    serverSubscription = null;
    return Promise.resolve();
  });
  jest.mocked(getChannelInfoSummary).mockResolvedValue({
    subscribers: 12,
    readers: 3,
    pops: 0,
    photos: 0,
    videos: 0,
    voices: 0,
  });
  jest.mocked(canPublishInChannel).mockResolvedValue(false);
  jest.mocked(listPops).mockResolvedValue([]);
  jest.mocked(getLastSeen).mockResolvedValue(new Map());
  jest.mocked(listChatMedia).mockResolvedValue({ items: [], next: null });
  jest.mocked(listChatVoices).mockResolvedValue({ items: [], next: null });
  jest.mocked(listChannelSubscribers).mockResolvedValue([]);
  jest.mocked(useProfile).mockReturnValue({
    data: { id: 'owner', displayName: 'Ольга', avatarUrl: null, username: null, bio: null, status: null },
  } as ReturnType<typeof useProfile>);
  jest.mocked(confirm).mockResolvedValue(true);
});

describe('ChannelInfoPage', () => {
  describe('outsider', () => {
    it('shows title, subscribers, info rows and the subscribe card, no action buttons', async () => {
      await renderPage();

      expect(screen.getByTestId('info-title')).toHaveTextContent('Новости');
      expect(screen.getByTestId('info-status')).toHaveTextContent('12 подписчиков');
      expect(screen.getByTestId('info-description')).toHaveTextContent(/Всё о главном/);
      expect(screen.getByTestId('info-channel-username')).toHaveTextContent(/@news\.ch/);
      expect(screen.getByTestId('info-channel-owner')).toHaveTextContent(/Ольга/);
      expect(await screen.findByTestId('info-subscribe')).toBeTruthy();
      expect(screen.queryByTestId(/^info-action-/)).toBeNull();
      expect(screen.queryByTestId('info-edit')).toBeNull();
    });

    it('menu: search and copy link only', async () => {
      await renderPage();
      await screen.findByTestId('info-subscribe');

      expect(await menuItems()).toEqual(['Поиск по постам', 'Скопировать ссылку']);
    });

    it('copies an openger://c/<name> link', async () => {
      await renderPage();
      await screen.findByTestId('info-subscribe');
      await menuItems();

      await fireEvent.press(screen.getByLabelText('Скопировать ссылку'));

      await waitFor(() =>
        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('openger://c/news'),
      );
    });

    it('subscribes without chats, then offers «Добавить в чаты»; the card goes away after it', async () => {
      await renderPage();

      await fireEvent.press(await screen.findByTestId('info-subscribe'));

      expect(subscribeToChannel).toHaveBeenCalledWith('channel-1', false);
      expect(await screen.findByTestId('info-subscribed')).toBeTruthy();
      expect(screen.getByTestId('info-status')).toHaveTextContent('13 подписчиков');
      expect(screen.getByTestId('info-action-add-to-chats')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('info-add-to-chats'));

      expect(setChannelInChats).toHaveBeenCalledWith('channel-1', true);
      await waitFor(() => expect(screen.queryByTestId('info-add-to-chats')).toBeNull());
      expect(screen.getByTestId('info-action-mute')).toBeTruthy();
    });

    it('has no subscribers tab even with subscribers', async () => {
      jest.mocked(getChannelInfoSummary).mockResolvedValue({
        subscribers: 12,
        readers: 3,
        pops: 4,
        photos: 1,
        videos: 0,
        voices: 0,
      });

      await renderPage();

      expect(await screen.findByTestId('info-tab-pops')).toBeTruthy();
      expect(screen.getByTestId('info-tab-media')).toBeTruthy();
      expect(screen.queryByTestId('info-tab-voices')).toBeNull();
      expect(screen.queryByTestId('info-tab-subscribers')).toBeNull();
      expect(listChannelSubscribers).not.toHaveBeenCalled();
    });
  });

  describe('subscriber', () => {
    it('«Добавить в чаты» and «Отписаться»; menu has unsubscribe', async () => {
      serveSubscription(subscription());

      await renderPage();

      expect(await screen.findByTestId('info-action-add-to-chats')).toBeTruthy();
      expect(screen.getByTestId('info-action-unsubscribe')).toBeTruthy();
      expect(screen.queryByTestId('info-subscribe')).toBeNull();
      expect(await menuItems()).toEqual(['Поиск по постам', 'Скопировать ссылку', 'Отписаться']);
    });

    it('unsubscribes after confirmation and shows the subscribe card again', async () => {
      serveSubscription(subscription());

      await renderPage();
      await fireEvent.press(await screen.findByTestId('info-action-unsubscribe'));

      expect(confirm).toHaveBeenCalled();
      expect(unsubscribeFromChannel).toHaveBeenCalledWith('channel-1');
      expect(await screen.findByTestId('info-subscribe')).toBeTruthy();
      expect(screen.getByTestId('info-status')).toHaveTextContent('12 подписчиков');
    });

    it('keeps the subscription when the confirmation is declined', async () => {
      serveSubscription(subscription());
      jest.mocked(confirm).mockResolvedValue(false);

      await renderPage();
      await fireEvent.press(await screen.findByTestId('info-action-unsubscribe'));

      expect(unsubscribeFromChannel).not.toHaveBeenCalled();
      expect(screen.getByTestId('info-action-add-to-chats')).toBeTruthy();
    });
  });

  describe('reader', () => {
    it('mute toggles the label at once; «Убрать из чатов» makes a subscriber', async () => {
      serveSubscription(subscription({ inChats: true }));

      await renderPage();

      await fireEvent.press(await screen.findByTestId('info-action-mute'));
      expect(setChannelNotifications).toHaveBeenCalledWith('channel-1', false);
      await waitFor(() =>
        expect(screen.getByTestId('info-action-mute')).toHaveTextContent(/Включить звук/),
      );

      await fireEvent.press(screen.getByTestId('info-action-hide'));
      expect(setChannelInChats).toHaveBeenCalledWith('channel-1', false);
      expect(await screen.findByTestId('info-action-add-to-chats')).toBeTruthy();
    });

    it('rolls a failed toggle back', async () => {
      serveSubscription(subscription({ inChats: true }));
      jest.mocked(setChannelNotifications).mockRejectedValueOnce(new Error('offline'));

      await renderPage();
      await fireEvent.press(await screen.findByTestId('info-action-mute'));

      await waitFor(() =>
        expect(screen.getByTestId('info-action-mute')).toHaveTextContent(/Без звука/),
      );
    });
  });

  describe('owner', () => {
    beforeEach(() => {
      mockUserId = 'owner';
      jest.mocked(canPublishInChannel).mockResolvedValue(true);
    });

    it('pencil, «Новый поп», «Подписчики», summary card and the owner menu', async () => {
      await renderPage();

      expect(screen.getByTestId('info-edit')).toBeTruthy();
      expect(screen.getByTestId('info-action-new-pop')).toBeTruthy();
      expect(screen.getByTestId('info-subscribers-summary')).toHaveTextContent(
        /Подписчики: 12 · Читатели: 3/,
      );
      expect(await menuItems()).toEqual(['Поиск по постам', 'Скопировать ссылку', 'Подписчики']);
    });

    it('«Новый поп» opens the pop editor of this channel', async () => {
      await renderPage();

      await fireEvent.press(screen.getByTestId('info-action-new-pop'));

      expect(mockPush).toHaveBeenCalledWith({
        name: 'PopEditor',
        params: { channelId: 'channel-1' },
      });
    });

    it('lists subscribers first, marks readers', async () => {
      jest.mocked(listChannelSubscribers).mockResolvedValue([
        {
          id: 's1',
          userId: 'anna',
          displayName: 'Анна',
          username: 'anna',
          avatarUrl: null,
          inChats: true,
          subscribedAt: '2026-10-14T10:00:00Z',
        },
        {
          id: 's2',
          userId: 'boris',
          displayName: 'Борис',
          username: null,
          avatarUrl: null,
          inChats: false,
          subscribedAt: '2026-10-13T10:00:00Z',
        },
      ]);

      await renderPage();
      await layoutCards();

      expect(screen.getByTestId('info-tab-subscribers')).toBeTruthy();
      expect(await screen.findByTestId('info-subscriber-anna')).toHaveTextContent(/читатель/);
      expect(screen.getByTestId('info-subscriber-boris')).not.toHaveTextContent(/читатель/);
    });

    it('keeps the subscribers tab with no subscribers, so its button leads somewhere', async () => {
      jest.mocked(getChannel).mockResolvedValue({ ...channel, subscribersCount: 0, readersCount: 0 });

      await renderPage();
      await layoutCards();

      expect(screen.getByTestId('info-tab-subscribers')).toBeTruthy();
      expect(await screen.findByText('Подписчиков пока нет')).toBeTruthy();
    });

    it('opens the edit screen from the pencil', async () => {
      await renderPage();

      await fireEvent.press(screen.getByTestId('info-edit'));

      expect(mockPush).toHaveBeenCalledWith({
        name: 'EditDetails', params: { target: { kind: 'channel', id: 'channel-1' } },
      });
    });
  });

  it('«Поиск по постам» opens the posts below in search mode', async () => {
    await renderPage();
    await screen.findByTestId('info-subscribe');
    await menuItems();

    await fireEvent.press(screen.getByLabelText('Поиск по постам'));

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SET_PARAMS',
          source: 'channel-key',
          payload: { params: expect.objectContaining({ search: '1', channelId: 'channel-1' }) },
        }),
      ),
    );
  });

  it('opens the channel on top when the same channel is only deeper in the stack', async () => {
    mockStack = {
      index: 3,
      routes: [
        ...STACK_OVER_CHANNEL.routes.slice(0, 2),
        { key: 'person', name: 'people/[userId]', params: { userId: 'owner' } },
        { key: 'info-key', name: 'channel-info/[channelId]', params: { channelId: 'channel-1' } },
      ],
    };

    await renderPage();
    await screen.findByTestId('info-subscribe');
    await menuItems();
    await fireEvent.press(screen.getByLabelText('Поиск по постам'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        name: 'Channel',
        params: expect.objectContaining({ channelId: 'channel-1', search: '1' }),
      }),
    );
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('without the channel shows a back arrow and an honest failure with retry', async () => {
    jest.mocked(getChannel).mockRejectedValue(new Error('boom'));

    await renderWithQuery(<ChannelInfoScreen />);

    expect(screen.getByTestId('info-back')).toBeTruthy();
    expect(await screen.findByText('Не удалось открыть канал')).toBeTruthy();
    expect(screen.queryByTestId('channel-info-page')).toBeNull();

    jest.mocked(getChannel).mockResolvedValue(channel);
    await fireEvent.press(screen.getByText('Повторить'));

    expect(await screen.findByTestId('channel-info-page')).toBeTruthy();
  });
});
