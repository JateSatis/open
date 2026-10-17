import { QueryClient } from '@tanstack/react-query';

import { commentOnSelection } from './openFragmentPanel';

import type { TextGeometry } from '../../../../modules/text-geometry';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import type { FragmentCluster } from '@/api/fragmentClusters';
import { clustersKey } from '@/features/chats/fragments/clusterKeys';
import { getFragmentState, setTextSelection } from '@/features/chats/fragments/fragmentStore';
import {
  closeComments,
  getCommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';

const mockedTrack = jest.mocked(trackClusterEvent);
const text = 'Огонь и вода 🔥 рядом';
const geometry: TextGeometry = { text, width: 0, height: 0, lines: [], xs: [] };

function select(start: number, end: number) {
  const selection = {
    rowKey: 'row-1',
    messageId: 'm1',
    chatId: 'chat-1',
    amMember: false,
    text,
    start,
    end,
    geometry,
    textInRow: { x: 0, y: 0 },
    textInWindow: { x: 0, y: 0 },
    dragging: null,
  };

  setTextSelection(selection);

  return selection;
}

const cluster: FragmentCluster = {
  id: 'k1',
  messageId: 'm1',
  start: 8,
  end: 12,
  quote: 'вода',
  popularity: 1,
  memberReactions: {},
  visitorReactions: {},
  reactionsCount: 1,
  commentsCount: 0,
  peopleCount: 1,
  fragmentsCount: 1,
  mine: null,
  myFragmentId: null,
  decisionId: 'd1',
};

function client() {
  const queryClient = new QueryClient();

  queryClient.setQueryData(clustersKey('m1', text), [cluster]);

  return queryClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  closeComments();
});

describe('💬 at a selection', () => {
  it('opens the cluster panel when the selection is exactly the shown cluster', () => {
    commentOnSelection(client(), select(8, 12));

    expect(getFragmentState().selection).toBeNull();
    expect(getCommentsPanelTarget()?.fragment).toMatchObject({
      kind: 'cluster',
      clusterId: 'k1',
      decisionId: 'd1',
      range: { start: 8, end: 12, text: 'вода' },
    });
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cluster_opened', clusterId: 'k1', decisionId: 'd1' }),
    );
  });

  it('opens the area panel with the keyboard otherwise — range in code points for the base', () => {
    // «🔥» — два UTF-16, одна кодовая точка: «рядом» в базе на один левее.
    commentOnSelection(client(), select(16, 21));

    expect(getCommentsPanelTarget()?.fragment).toMatchObject({
      kind: 'area',
      focusInput: true,
      range: { start: 15, end: 20, text: 'рядом' },
    });
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'area_opened', messageId: 'm1', rangeStart: 15, rangeEnd: 20 }),
    );
  });

  it('an area overlapping the cluster but not equal to it is an area', () => {
    commentOnSelection(client(), select(6, 12));

    expect(getCommentsPanelTarget()?.fragment?.kind).toBe('area');
  });
});
