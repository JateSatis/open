import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ChatInfoPage } from '.';

import { useSlideBack } from '@/components/InfoPage';

import {
  getChatInfoSummary,
  getLastSeen,
  listChatMedia,
  listChatVoices,
  listCommonGroups,
  type ChatInfoSummary,
} from '@/api/chatInfo';
import type { ChatSummary } from '@/api/chats';
import { getMyChatSubscription, subscribeToChat, unsubscribeFromChat } from '@/api/subscriptions';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

jest.mock('@/api/chatInfo', () => ({
  getChatInfoSummary: jest.fn(),
  getLastSeen: jest.fn(),
  listChatMedia: jest.fn(),
  listChatVoices: jest.fn(),
  listCommonGroups: jest.fn(),
}));

jest.mock('@/features/profile/queries', () => ({ useProfile: jest.fn() }));

const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
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

const mockStartCall = jest.fn();

jest.mock('@/features/streams/useChatCall', () => ({
  useChatCall: () => ({
    stream: null,
    isInThisCall: false,
    busy: false,
    startOrJoin: mockStartCall,
    openBar: jest.fn(),
  }),
}));

let mockUserId = 'me';
let mockOnline = new Set<string>();

jest.mock('@/features/chats/useCurrentUserId', () => ({ useCurrentUserId: () => mockUserId }));
jest.mock('@/features/chats/useOnlineUsers', () => ({ useOnlineUsers: () => mockOnline }));

const mockedSummary = getChatInfoSummary as jest.MockedFunction<typeof getChatInfoSummary>;
const mockedLastSeen = getLastSeen as jest.MockedFunction<typeof getLastSeen>;
const mockedProfile = useProfile as jest.Mock;

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  avatarUrl: null,
  lastReadAt: '2026-10-12T10:00:00Z',
});

const base: ChatSummary = {
  id: 'chat-1',
  kind: 'group',
  avatarUrl: null,
  title: 'Команда',
  username: null,
  channel: null,
  participants: [person('anna', 'Анна'), person('me', 'Я'), person('oleg', 'Олег')],
  waiting: [],
  lastMessagePreview: null,
  lastMessageAt: null,
  lastMessageAuthorId: null,
  lastPopAt: null,
  lastActivityAt: null,
  previewIsPop: false,
  subscription: null,
  hasUnread: false,
  subscribersCount: 4,
};

const dialog: ChatSummary = {
  ...base,
  kind: 'direct',
  title: null,
  participants: [person('me', 'Я'), person('anna', 'Анна')],
};

const strangers: ChatSummary = {
  ...dialog,
  participants: [person('anna', 'Анна'), person('boris', 'Борис')],
};

/** Страница с въездом и уходом — как её отдаёт маршрут. */
function Page({ chat }: { chat: ChatSummary }) {
  return <ChatInfoPage chat={chat} slideBack={useSlideBack()} />;
}

/** В тестах раскладки нет: карточки «меряются» вручную, и вкладки монтируются. */
async function layoutCards() {
  await fireEvent(screen.getByTestId('info-cards'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 120 } },
  });
}

function summary(overrides: Partial<ChatInfoSummary> = {}): ChatInfoSummary {
  return { ownerId: 'anna', photos: 0, videos: 0, voices: 0, commonGroups: 0, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'me';
  mockOnline = new Set();
  mockedSummary.mockResolvedValue(summary());
  mockedLastSeen.mockResolvedValue(new Map());
  jest.mocked(listChatMedia).mockResolvedValue({ items: [], next: null });
  jest.mocked(listChatVoices).mockResolvedValue({ items: [], next: null });
  jest.mocked(listCommonGroups).mockResolvedValue({ items: [], next: null });
  mockedProfile.mockReturnValue({ data: undefined });
  jest.mocked(getMyChatSubscription).mockReset().mockResolvedValue(null);
});

describe('ChatInfoPage', () => {
  describe('group, as a member', () => {
    it('shows the title and member count from the cached chat in the first frame', async () => {
      await renderWithQuery(<Page chat={base} />);

      expect(screen.getByTestId('info-title')).toHaveTextContent('Команда');
      expect(screen.getByTestId('info-status')).toHaveTextContent('3 участника');
      expect(screen.getByTestId('info-edit')).toBeTruthy();
      expect(screen.queryByTestId('info-subscribe')).toBeNull();
    });

    it('lists members with me first, then online, and marks the owner', async () => {
      mockOnline = new Set(['oleg']);
      mockedLastSeen.mockResolvedValue(new Map([['anna', null]]));

      await renderWithQuery(<Page chat={base} />);
      await layoutCards();

      expect(await screen.findByText('владелец')).toBeTruthy();
      const rows = screen.getAllByTestId(/^info-member-/).map((row) => row.props.testID);
      expect(rows).toEqual(['info-member-me', 'info-member-oleg', 'info-member-anna']);
      expect((await screen.findAllByText('был(а) давно')).length).toBeGreaterThan(0);
    });

    it('opens a member profile on tap', async () => {
      await renderWithQuery(<Page chat={base} />);
      await layoutCards();

      await fireEvent.press(await screen.findByTestId('info-member-anna'));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/people/[userId]',
        params: { userId: 'anna' },
      });
    });

    it('hides empty tabs and shows the ones with content', async () => {
      mockedSummary.mockResolvedValue(summary({ photos: 2 }));

      await renderWithQuery(<Page chat={base} />);

      expect(await screen.findByTestId('info-tab-media')).toBeTruthy();
      expect(screen.getByTestId('info-tab-members')).toBeTruthy();
      expect(screen.queryByTestId('info-tab-voices')).toBeNull();
    });

    it('shows @name.di in a card only when the group has one', async () => {
      const { unmount } = await renderWithQuery(<Page chat={base} />);

      expect(screen.queryByTestId('info-card')).toBeNull();
      await unmount();

      await renderWithQuery(<Page chat={{ ...base, username: 'team' }} />);
      expect(screen.getByTestId('info-group-username')).toHaveTextContent(/@team\.di/);
    });
  });

  describe('own dialog', () => {
    it('is about the other person: name, «в сети» and a call button', async () => {
      mockOnline = new Set(['anna']);

      await renderWithQuery(<Page chat={dialog} />);

      expect(screen.getByTestId('info-title')).toHaveTextContent('Анна');
      expect(await screen.findByText('в сети')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('info-action-call'));
      expect(mockStartCall).toHaveBeenCalled();
      expect(screen.queryByTestId('info-edit')).toBeNull();
    });

    it('says when they were last seen', async () => {
      const today = new Date();
      today.setHours(16, 10, 0, 0);
      mockedLastSeen.mockResolvedValue(new Map([['anna', today.toISOString()]]));

      await renderWithQuery(<Page chat={dialog} />);

      expect(await screen.findByText('был(а) в 16:10')).toBeTruthy();
    });

    it('shows «О себе» and the username, and skips what is missing', async () => {
      mockedProfile.mockReturnValue({
        data: {
          id: 'anna',
          username: 'anna',
          displayName: 'Анна',
          bio: 'Люблю горы',
          status: null,
        },
      });

      const { unmount } = await renderWithQuery(<Page chat={dialog} />);

      expect(screen.getByTestId('info-bio')).toHaveTextContent(/Люблю горы/);
      expect(screen.getByTestId('info-username')).toHaveTextContent(/@anna/);
      await unmount();

      mockedProfile.mockReturnValue({
        data: { id: 'anna', username: 'anna', displayName: 'Анна', bio: null, status: null },
      });
      await renderWithQuery(<Page chat={dialog} />);

      expect(screen.queryByTestId('info-bio')).toBeNull();
      expect(screen.queryByText(/О себе/)).toBeNull();
    });

    it('says plainly when the tabs could not be loaded, and retries', async () => {
      mockedSummary
        .mockRejectedValueOnce(new Error('сбой'))
        .mockResolvedValue(summary({ photos: 1 }));

      await renderWithQuery(<Page chat={dialog} />);

      expect(await screen.findByText('Не удалось загрузить медиа и голосовые')).toBeTruthy();
      await fireEvent.press(screen.getByText('Повторить'));

      expect(await screen.findByTestId('info-tab-media')).toBeTruthy();
    });

    it('shows «Общие группы» only when there are some', async () => {
      mockedSummary.mockResolvedValue(summary({ commonGroups: 1 }));

      await renderWithQuery(<Page chat={dialog} />);

      expect(await screen.findByTestId('info-tab-groups')).toBeTruthy();
    });
  });

  describe('outsider', () => {
    beforeEach(() => {
      mockUserId = 'stranger';
    });

    it('sees two people in someone else’s dialog, without actions of a member', async () => {
      await renderWithQuery(<Page chat={strangers} />);

      expect(screen.getByTestId('info-title')).toHaveTextContent('Анна и Борис');
      expect(screen.getByTestId('info-status')).toHaveTextContent('4 подписчика');
      expect(screen.getByTestId('info-person-anna')).toBeTruthy();
      expect(screen.getByTestId('info-person-boris')).toBeTruthy();
      expect(screen.queryByTestId('info-action-call')).toBeNull();
      expect(screen.queryByTestId('info-edit')).toBeNull();

      await fireEvent.press(screen.getByTestId('info-person-boris'));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/chats/people/[userId]',
        params: { userId: 'boris' },
      });
    });

    it('subscribes at once', async () => {
      jest.mocked(getMyChatSubscription).mockResolvedValueOnce(null).mockResolvedValue({
        channelId: null,
        chatId: 'chat-1',
        inChats: true,
        notify: true,
        unreadPosts: 0,
        unreadPops: 0,
      });

      await renderWithQuery(<Page chat={strangers} />);

      await fireEvent.press(await screen.findByText('Подписаться на диалог'));

      expect(await screen.findByText('Вы подписаны')).toBeTruthy();
      expect(subscribeToChat).toHaveBeenCalledWith('chat-1');
      expect(unsubscribeFromChat).not.toHaveBeenCalled();
    });

    it('rolls the subscription back with a plain message when it fails', async () => {
      jest.mocked(subscribeToChat).mockRejectedValueOnce(new TypeError('Network request failed'));

      await renderWithQuery(<Page chat={strangers} />);
      await fireEvent.press(await screen.findByText('Подписаться на диалог'));

      await waitFor(() => expect(screen.getByText('Подписаться на диалог')).toBeTruthy());
      // Фраза — всплывашкой приложения, а не сырой ошибкой.
      expect(useInAppAlert.getState().alert).toMatchObject({ text: 'Не удалось подписаться' });
    });

    it('sees a foreign group with its members, but no pencil', async () => {
      jest.mocked(getMyChatSubscription).mockResolvedValue(null);

      await renderWithQuery(<Page chat={{ ...base, username: 'team' }} />);

      expect(screen.queryByTestId('info-edit')).toBeNull();
      expect(screen.getByTestId('info-group-username')).toBeTruthy();
      expect(await screen.findByText('Подписаться на группу')).toBeTruthy();
      await act(async () => undefined);
      expect(screen.getByTestId('info-tab-members')).toBeTruthy();
    });
  });
});
