import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { AreaHeader } from './AreaHeader';
import { ClusterHeader } from './ClusterHeader';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import { getAreaSummary, listMessageClusters, type FragmentCluster } from '@/api/fragmentClusters';
import { listMessageFragments, setFragmentReaction, type Fragment } from '@/api/fragments';
import { useSession } from '@/features/auth/useSession';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/chats', () => ({ subscribeToChatSignals: jest.fn(() => jest.fn()) }));
jest.mock('@/api/fragmentClusterEvents', () => ({ trackClusterEvent: jest.fn() }));
jest.mock('@/api/fragmentClusters', () => ({
  listMessageClusters: jest.fn(),
  getAreaSummary: jest.fn(),
}));

const mockedClusters = jest.mocked(listMessageClusters);
const mockedArea = jest.mocked(getAreaSummary);
const mockedFragments = jest.mocked(listMessageFragments);
const mockedSet = jest.mocked(setFragmentReaction);
const mockedTrack = jest.mocked(trackClusterEvent);

const text = 'слово может улететь в ленту';
const display = { start: 0, end: 19, text: 'слово может улететь' };

const cluster: FragmentCluster = {
  id: 'k1',
  messageId: 'm1',
  start: 0,
  end: 19,
  quote: display.text,
  popularity: 2,
  memberReactions: {},
  visitorReactions: { '🔥': 2, '🤣': 1 },
  reactionsCount: 3,
  commentsCount: 0,
  peopleCount: 3,
  fragmentsCount: 2,
  mine: '🔥',
  myFragmentId: 'f-mine',
  decisionId: 'd1',
};

function fragment(overrides: Partial<Fragment>): Fragment {
  return {
    id: 'f-mine',
    messageId: 'm1',
    authorId: 'me',
    start: 12,
    end: 19,
    exactText: 'улететь',
    lost: false,
    memberReactions: {},
    visitorReactions: { '🔥': 1 },
    reactionsCount: 1,
    commentsCount: 0,
    mine: '🔥',
    clusterId: 'k1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({
    session: { user: { id: 'me' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedSet.mockReturnValue(new Promise(() => undefined));
  mockedClusters.mockResolvedValue([cluster]);
  mockedFragments.mockResolvedValue([fragment({})]);
});

async function renderCluster(messageId = 'm1') {
  await renderWithQuery(
    <ClusterHeader
      messageId={messageId}
      chatId="c1"
      subject={{
        kind: 'cluster',
        key: 'cluster:k1',
        clusterId: 'k1',
        decisionId: 'd1',
        range: display,
        messageText: text,
        focusInput: false,
      }}
      amMember={false}
      width={360}
    />,
  );
  await act(async () => undefined);
}

describe('cluster panel header', () => {
  it('quotes the shown piece and sums the cluster reactions, mine marked', async () => {
    await renderCluster();

    expect(screen.getByTestId('fragment-quote')).toHaveTextContent('слово может улететь');
    expect(await screen.findByLabelText('Снять реакцию 🔥')).toBeTruthy();
    expect(screen.getByLabelText('Реакция 🤣, 1')).toBeTruthy();
  });

  it('a tap on another reaction puts it on my fragment of the shown piece and takes mine off at once', async () => {
    await renderCluster();
    await act(async () => fireEvent.press(await screen.findByLabelText('Реакция 🤣, 1')));

    expect(mockedSet).toHaveBeenLastCalledWith('m1', display, '🤣');
    expect(await screen.findByLabelText('Снять реакцию 🤣')).toBeTruthy();
    expect(await screen.findByLabelText('Реакция 🔥, 1')).toBeTruthy();
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cluster_reacted', clusterId: 'k1', decisionId: 'd1' }),
    );
  });

  it('a reaction just put from the panel is taken off from the panel’s piece, not the old fragment', async () => {
    mockedSet.mockResolvedValue({ fragmentId: 'f-new', mine: null });
    // После ответа базы — перечитанные: моя 🤣 на новом фрагменте ровно куска панели.
    mockedClusters
      .mockResolvedValueOnce([cluster])
      .mockResolvedValue([
        { ...cluster, visitorReactions: { '🔥': 1, '🤣': 2 }, mine: '🤣', myFragmentId: 'f-new' },
      ]);
    mockedFragments
      .mockResolvedValueOnce([fragment({})])
      .mockResolvedValue([
        fragment({ mine: null }),
        fragment({ id: 'f-new', start: 0, end: 19, exactText: display.text, mine: '🤣' }),
      ]);

    // Своё сообщение: очередь реакций живёт вне компонентов, запросы прошлых тестов в ней висят.
    await renderCluster('m2');
    await act(async () => fireEvent.press(await screen.findByLabelText('Реакция 🤣, 1')));
    await act(async () => fireEvent.press(await screen.findByLabelText('Снять реакцию 🤣')));

    await waitFor(() => expect(mockedSet).toHaveBeenLastCalledWith('m2', display, null));
  });

  it('a tap on my reaction takes it off where it stands — on my other fragment of the cluster', async () => {
    await renderCluster();
    await act(async () => fireEvent.press(await screen.findByLabelText('Снять реакцию 🔥')));

    expect(mockedSet).toHaveBeenLastCalledWith('m1', { start: 12, end: 19, text: 'улететь' }, null);
    expect(await screen.findByLabelText('Реакция 🔥, 1')).toBeTruthy();
  });
});

describe('area panel header', () => {
  const area = { start: 6, end: 27, text: 'может улететь в ленту' };

  async function renderArea() {
    await renderWithQuery(
      <AreaHeader
        messageId="m1"
        subject={{ kind: 'area', key: 'area:6-27', range: area, messageText: text, focusInput: true }}
        amMember={false}
        width={360}
      />,
    );
    await act(async () => undefined);
  }

  it('sums the fragments inside and marks my reaction in the cluster my fragment will join', async () => {
    mockedArea.mockResolvedValue({
      fragmentIds: ['f-mine', 'f-other'],
      memberReactions: {},
      visitorReactions: { '🔥': 2 },
      reactionsCount: 2,
      commentsCount: 1,
      myClusterId: 'k1',
      mine: '🔥',
      myFragmentId: 'f-mine',
    });

    await renderArea();

    expect(mockedArea).toHaveBeenCalledWith('m1', 6, 27);
    expect(await screen.findByLabelText('Снять реакцию 🔥')).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByLabelText('Все реакции')));
    await act(async () => fireEvent.press(screen.getByTestId('reaction-option-👍')));

    expect(mockedSet).toHaveBeenLastCalledWith('m1', area, '👍');
    // Прежняя моя в кластере погасла, новая — на фрагменте ровно области — внутри.
    expect(await screen.findByLabelText('Реакция 🔥, 1')).toBeTruthy();
    expect(await screen.findByLabelText('Снять реакцию 👍')).toBeTruthy();
  });

  it('marks my reaction in the cluster even when its fragment is not inside the area', async () => {
    mockedArea.mockResolvedValue({
      fragmentIds: [],
      memberReactions: {},
      visitorReactions: {},
      reactionsCount: 0,
      commentsCount: 0,
      myClusterId: 'k1',
      mine: '🤣',
      myFragmentId: 'f-mine',
    });

    await renderArea();

    expect(await screen.findByLabelText('Снять реакцию 🤣')).toBeTruthy();
  });

  it('an empty area is a quote and the whole set', async () => {
    mockedArea.mockResolvedValue({
      fragmentIds: [],
      memberReactions: {},
      visitorReactions: {},
      reactionsCount: 0,
      commentsCount: 0,
      myClusterId: null,
      mine: null,
      myFragmentId: null,
    });

    await renderArea();

    expect(screen.getByTestId('fragment-quote')).toHaveTextContent('может улететь в ленту');
    expect(screen.queryByLabelText(/Реакция/)).toBeNull();
    expect(screen.getByLabelText('Все реакции')).toBeTruthy();
  });
});
