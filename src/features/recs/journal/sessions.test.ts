import { journalScreen } from '@/navigation/journalScreen';
import { useSessionStore, emptyState } from '@/features/auth/sessionState';
import { sessionOf } from '@/test/sessionOf';
import { getLinkingURL } from 'expo-linking';
import { startJournalLifecycle } from './lifecycle';
import { journal } from './journal';
import {
  setSessionUser,
  splashHidden,
  appCameForeground,
  appWentBackground,
  enterScreen,
  resetAppSessionForTests,
  SESSION_GAP_MS,
  startAppSession,
} from './appSession';
import {
  chatVisibleMessages,
  endChatSession,
  forwardPickerClosed,
  forwardPickerOpened,
  startChatSession,
} from './chatJournal';
import {
  commentsComposerFocused,
  commentsComposerTyping,
  commentsShown,
  commentsTargetChanged,
  commentThreadOpened,
  commentsVoiceActivity,
} from './commentsJournal';
import { logSearchQuery, normalizeQuery } from './searchJournal';
import { noteVoiceOwner, voicePlaybackChanged } from './voiceJournal';

const mockLog = jest.fn((..._args: unknown[]) => 'id');

jest.mock('./journal', () => ({
  journal: {
    log: (...args: unknown[]) => mockLog(...args),
    setAppSession: jest.fn(),
    showFirstScreen: jest.fn(),
    setUser: jest.fn(),
    setDeliveryUser: jest.fn(),
    kick: jest.fn(),
    persist: jest.fn(),
  },
  JOURNAL_FLUSH_MS: 5000,
}));
jest.mock('./device', () => ({
  startDeviceWatch: jest.fn(),
  deviceContext: () => ({ platform: 'android' }),
  currentAudio: () => null,
  currentNetwork: () => 'wifi',
  currentOrientation: () => 'portrait',
  onAudioChange: () => () => undefined,
}));
jest.mock('expo-linking', () => ({ getLinkingURL: jest.fn() }));

type Logged = { kind: string; fields: { data?: Record<string, unknown>; subject?: unknown } };

function logged(kind: string): Logged[] {
  return mockLog.mock.calls
    .filter((call) => call[0] === kind)
    .map((call) => ({ kind: call[0] as string, fields: call[1] as Logged['fields'] }));
}

beforeEach(() => {
  mockLog.mockClear();
});

describe('сессия комментариев', () => {
  it('открыл, пролистал, раскрыл тред, начал писать и стёр, закрыл — одна сессия с брошенным полем', () => {
    const target = { subject: { type: 'pop' as const, id: 'pop-1' } };

    commentsTargetChanged(target, 1000);
    commentsShown(
      Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, index, pinned: index === 0 })),
      'main',
    );
    commentThreadOpened('c3');
    commentsShown(
      [
        { id: 'c3', index: 0, commentThreadRoot: true },
        { id: 'r1', index: 1 },
      ],
      'commentThread',
    );
    commentsComposerFocused();
    commentsComposerTyping(5000);
    commentsTargetChanged(null, 9000);

    const [session] = logged('comments_session');

    expect(logged('comments_session')).toHaveLength(1);
    expect(session.fields.subject).toEqual({ type: 'pop', id: 'pop-1' });
    expect(session.fields.data).toMatchObject({
      ms: 8000,
      opened_from: 'pop',
      shown: 10,
      max_depth: 10,
      threads_expanded: 1,
      replies_shown: 1,
      pinned_seen: true,
      composer: 'abandoned',
      typing_ms: 4000,
    });
  });

  it('запись голосового: сигналы подряд — одна запись, после паузы — следующая', () => {
    commentsTargetChanged({ subject: { type: 'message', id: 'm1' }, chatId: 'chat-1' }, 0);
    commentsVoiceActivity(1000);
    commentsVoiceActivity(2000);
    commentsVoiceActivity(10_000);
    commentsTargetChanged(null, 11_000);

    expect(logged('comments_session')[0].fields.data).toMatchObject({
      opened_from: 'chat',
      voice_started: 2,
      voice_cancelled: 2,
      composer: 'none',
    });
  });
});

describe('сессия чата', () => {
  it('время сообщений на экране и вход', () => {
    startChatSession('chat-1', 'search', 'visitor', 0);
    chatVisibleMessages('chat-1', ['a', 'b'], 0);
    chatVisibleMessages('chat-1', ['b', 'c'], 2000);
    endChatSession(undefined, 5000);

    const [session] = logged('chat_session');

    expect(session.fields.data).toMatchObject({
      ms: 5000,
      entry: 'search',
      role: 'visitor',
      messages_seen: 3,
    });
    expect(session.fields.data?.dwell).toEqual([
      { id: 'b', ms: 5000 },
      { id: 'c', ms: 3000 },
      { id: 'a', ms: 2000 },
    ]);
  });

  it('выбор чата для пересылки: открыли и бросили', () => {
    forwardPickerOpened({ type: 'message', id: 'm1' }, 2);
    forwardPickerClosed('cancelled');
    forwardPickerClosed('cancelled');

    expect(logged('forward_picker')).toHaveLength(1);
    expect(logged('forward_picker')[0].fields.data).toMatchObject({
      outcome: 'cancelled',
      items: 2,
    });
  });
});

describe('голосовые', () => {
  it('послушал половину и ушёл — около 50%, не дослушано', () => {
    noteVoiceOwner('file://v.m4a', 'msg-1');

    const base = { activeKey: 'file://v.m4a', durationMs: 10_000 };

    voicePlaybackChanged(
      { ...base, playing: true, positionMs: 0 },
      { activeKey: null, positionMs: 0, durationMs: 0 },
      0,
    );
    voicePlaybackChanged(
      { ...base, playing: true, positionMs: 5000 },
      { ...base, positionMs: 0 },
      5000,
    );
    voicePlaybackChanged(
      { ...base, playing: false, positionMs: 5000 },
      { ...base, positionMs: 5000 },
      5000,
    );
    voicePlaybackChanged(
      { activeKey: null, playing: false, positionMs: 0, durationMs: 0 },
      { ...base, positionMs: 5000 },
      6000,
    );

    const [play] = logged('voice_play');

    expect(play.fields.subject).toEqual({ type: 'message', id: 'msg-1' });
    expect(play.fields.data).toMatchObject({
      listened_ms: 5000,
      max_pos_ms: 5000,
      duration_ms: 10_000,
      completed: false,
    });
  });
});

describe('поиск', () => {
  it('запрос нормализуется, повтор того же — одно событие', () => {
    expect(normalizeQuery('  Котики   ДНЯ ')).toBe('котики дня');

    logSearchQuery('feed', 'Котики', { pops: 3 });
    logSearchQuery('feed', ' котики ', { pops: 3 });
    logSearchQuery('feed', '', { pops: 0 });

    expect(logged('search_query')).toHaveLength(1);
    expect(logged('search_query')[0].fields.data).toMatchObject({
      scope: 'feed',
      query: 'котики',
      pops: 3,
    });
  });
});

describe('сессия приложения', () => {
  beforeEach(() => resetAppSessionForTests());

  it('распознаёт ссылку при позднем владельце, повторном подключении и обновлении токена', () => {
    jest.mocked(getLinkingURL).mockReturnValue('openger://chats');
    startJournalLifecycle(1000);
    expect(logged('app_session_start')).toHaveLength(0);
    useSessionStore.setState({ localAccountId: 'u1' });
    startJournalLifecycle(2000);
    useSessionStore.setState({ sdkStatus: 'session', session: sessionOf('u1', 's') });
    useSessionStore.setState({ session: sessionOf('u1', 's', 2) });
    expect(getLinkingURL).toHaveBeenCalledTimes(1);
    expect(logged('app_session_start').map((e) => e.fields)).toEqual([
      expect.objectContaining({ at: 1000, data: expect.objectContaining({ entry: 'link' }) }),
    ]);
    useSessionStore.setState(emptyState);
  });

  it('время на экранах, уход в фон и возврат: недолгий фон — та же сессия, долгий — новая', () => {
    startAppSession('cold', 0);
    setSessionUser('u1', 0);
    enterScreen('chats', 'chats', 0);
    splashHidden(0);
    enterScreen('pops/[channelId]', null, 4000);
    appWentBackground(10_000);
    appCameForeground(20_000);
    appWentBackground(30_000);
    appCameForeground(30_000 + SESSION_GAP_MS + 1);

    expect(logged('app_session_start').map((e) => e.fields.data?.entry)).toEqual([
      'cold',
      'resume',
    ]);
    expect(logged('screen_time').map((e) => e.fields.data)).toEqual([
      { screen: 'chats', tab: 'chats', ms: 4000 },
      { screen: 'pops/[channelId]', tab: undefined, ms: 6000 },
      { screen: 'pops/[channelId]', tab: undefined, ms: 10_000 },
    ]);
    expect(logged('app_background').map((e) => e.fields.data?.fg_ms)).toEqual([10_000, 10_000]);
    expect(logged('app_foreground').map((e) => e.fields.data?.bg_ms)).toEqual([10_000]);
  });

  it('холодный запуск получает время старта JS, маршрут — только видимое время', () => {
    startAppSession('cold', 1000);
    expect(mockLog).not.toHaveBeenCalled();
    setSessionUser('u1', 2000);
    enterScreen('chats', 'chats', 2100);
    enterScreen('feed', 'feed', 2200);
    splashHidden(3000);
    startAppSession('cold', 3100);
    setSessionUser('u1', 3200);
    enterScreen('feed', 'feed', 3300);
    splashHidden(3400);
    appWentBackground(4000);
    enterScreen('profile', 'profile', 7000);
    appCameForeground(9000);
    enterScreen('chats', 'chats', 9500);

    expect(logged('app_session_start').map((e) => e.fields)).toEqual([
      expect.objectContaining({ at: 1000, data: expect.objectContaining({ entry: 'cold' }) }),
    ]);
    expect(logged('screen_time').map((e) => e.fields.data)).toEqual([
      { screen: 'feed', tab: 'feed', ms: 1000 },
      { screen: 'profile', tab: 'profile', ms: 500 },
    ]);
  });

  it('вошёл другой человек — для него новая сессия', () => {
    startAppSession('cold', 0);
    setSessionUser('u1', 0);
    setSessionUser('u1', 10);
    setSessionUser('u2', 20);

    expect(logged('app_session_start').map((e) => e.fields.data?.entry)).toEqual([
      'cold',
      'account',
    ]);
  });

  it('закрывает просмотры A до переключения на B, даже если React очистит экран позже', () => {
    let owner: string | null = null;
    const writes: [string | null, unknown][] = [];
    jest.mocked(journal.setUser).mockImplementation((next) => {
      owner = next;
    });
    mockLog.mockImplementation((kind) => {
      writes.push([owner, kind]);
      return 'id';
    });
    try {
      startAppSession('cold', 0);
      setSessionUser('a', 100);
      startChatSession('chat-a', 'list', 'member', 110);
      chatVisibleMessages('chat-a', ['msg-a'], 120);
      commentsTargetChanged({ subject: { type: 'message', id: 'msg-a' } }, 130);
      setSessionUser('b', 200);
      endChatSession('chat-a', 210);
      commentsTargetChanged(null, 220);
      expect(writes).toEqual([
        ['a', 'app_session_start'],
        ['a', 'chat_session'],
        ['a', 'comments_session'],
        ['b', 'app_session_start'],
      ]);
    } finally {
      mockLog.mockImplementation(() => 'id');
      jest.mocked(journal.setUser).mockReset();
    }
  });

  it('имя экрана — по шаблону маршрута, без групп', () => {
    expect(journalScreen('Chat', 'chats')).toEqual({
      screen: 'chats/[chatId]',
      tab: 'chats',
    });
    expect(journalScreen('PopViewer', 'feed', { source: 'search' })).toEqual({
      screen: 'pops/search',
      tab: null,
    });
  });
});
