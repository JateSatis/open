import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { SelectableText } from '.';

import { measureText } from '../../../../../modules/text-geometry';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import { listMessageClusters, type FragmentCluster } from '@/api/fragmentClusters';
import {
  clearTextSelection,
  exitFragmentMode,
  setTextSelection,
  toggleFragmentMode,
} from '@/features/chats/fragments/fragmentStore';
import {
  closeComments,
  getCommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({ subscribeToChatSignals: jest.fn(() => jest.fn()) }));
jest.mock('@/api/fragmentClusterEvents', () => ({ trackClusterEvent: jest.fn() }));
jest.mock('@/api/fragmentClusters', () => ({ listMessageClusters: jest.fn() }));
jest.mock('../../../../../modules/text-geometry', () => ({
  measureText: jest.fn(),
  textGeometryAvailable: true,
}));

const text = 'какой-то другой уровень';
const geometry = {
  text,
  width: 200,
  height: 20,
  lines: [{ start: 0, end: 23, top: 0, bottom: 20, baseline: 15, left: 0, right: 184 }],
  xs: [...text].map((_, i) => i * 8),
};

function cluster(id: string, start: number, end: number): FragmentCluster {
  return {
    id,
    messageId: 'm1',
    start,
    end,
    quote: text.slice(start, end),
    popularity: 1,
    memberReactions: {},
    visitorReactions: { '🔥': 1 },
    reactionsCount: 1,
    commentsCount: 0,
    peopleCount: 1,
    fragmentsCount: 1,
    mine: null,
    myFragmentId: null,
    decisionId: 'd1',
  };
}

const mockedClusters = jest.mocked(listMessageClusters);
const mockedTrack = jest.mocked(trackClusterEvent);

beforeEach(() => {
  jest.clearAllMocks();
  exitFragmentMode();
  closeComments();
  jest.mocked(measureText).mockResolvedValue(geometry);
  mockedClusters.mockResolvedValue([cluster('k1', 0, 8), cluster('k2', 9, 15)]);
});

async function renderText(fragmentsCount = 2) {
  await renderWithQuery(
    <SelectableText
      text={text}
      isOwn={false}
      rowKey="m1"
      messageId="m1"
      chatId="chat-1"
      amMember={false}
      fragmentsCount={fragmentsCount}
    />,
  );
}

describe('clusters on the text of a bubble', () => {
  it('are not asked for nor shown outside the fragment mode', async () => {
    await renderText();

    expect(mockedClusters).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cluster-highlight')).toBeNull();
  });

  it('light up in the mode, and the show is told once per entry', async () => {
    await renderText();
    await act(async () => toggleFragmentMode('m1'));

    expect(await screen.findAllByTestId('cluster-highlight')).toHaveLength(2);
    expect(mockedTrack).toHaveBeenCalledTimes(1);
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'clusters_shown', messageId: 'm1', decisionId: 'd1' }),
    );
  });

  it('hide while text is selected and come back when the selection is gone', async () => {
    await renderText();
    await act(async () => toggleFragmentMode('m1'));
    await screen.findAllByTestId('cluster-highlight');

    await act(async () =>
      setTextSelection({
        rowKey: 'm1',
        messageId: 'm1',
        chatId: 'chat-1',
        amMember: false,
        text,
        start: 0,
        end: 5,
        geometry,
        textInRow: { x: 0, y: 0 },
        textInWindow: { x: 0, y: 0 },
        dragging: null,
      }),
    );
    expect(screen.queryByTestId('cluster-highlight')).toBeNull();

    await act(async () => clearTextSelection());
    expect(screen.getAllByTestId('cluster-highlight')).toHaveLength(2);
  });

  it('a tap on the highlight opens the panel of that cluster', async () => {
    await renderText();
    await act(async () => toggleFragmentMode('m1'));
    await screen.findAllByTestId('cluster-highlight');

    await act(async () => fireEvent.press(screen.getByTestId('cluster-hit-k2')));

    expect(getCommentsPanelTarget()?.fragment).toMatchObject({
      kind: 'cluster',
      clusterId: 'k2',
      range: { start: 9, end: 15, text: 'другой' },
    });
    expect(mockedTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'cluster_opened', clusterId: 'k2', decisionId: 'd1' }),
    );
  });

  it('keep the old highlight while a panel is open and take the recount after', async () => {
    await renderText();
    await act(async () => toggleFragmentMode('m1'));
    await screen.findAllByTestId('cluster-highlight');
    await act(async () => fireEvent.press(screen.getByTestId('cluster-hit-k1')));

    mockedClusters.mockResolvedValue([cluster('k1', 0, 15)]);
    // Пересчёт пришёл — перечитывание идёт, а подсветка ждёт закрытия панели.
    const { subscribeToChatSignals } = jest.requireMock('@/api/chats');
    const listener = subscribeToChatSignals.mock.calls.at(-1)[1];

    await act(async () => listener.onClustersChanged('m1'));
    await waitFor(() => expect(mockedClusters).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId('cluster-highlight')).toHaveLength(2);

    await act(async () => closeComments());
    expect(screen.getAllByTestId('cluster-highlight')).toHaveLength(1);
  });
});
