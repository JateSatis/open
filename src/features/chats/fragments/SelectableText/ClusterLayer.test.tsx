import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ClusterLayer } from './ClusterLayer';
import type { ClusterPatternProps } from './ClusterPattern';

import type { FragmentCluster } from '@/api/fragmentClusters';
import { clusterTone } from '@/features/chats/fragments/reactionStyle';
import { Colors } from '@/theme';

const mockPattern = jest.fn();

jest.mock('./ClusterPattern', () => ({
  ClusterPattern: (props: ClusterPatternProps) => {
    mockPattern(props);
    return null;
  },
}));

const text = 'любовь грусть думаю';
const geometry = {
  text,
  width: 200,
  height: 20,
  lines: [{ start: 0, end: text.length, top: 0, bottom: 20, baseline: 15, left: 0, right: 152 }],
  xs: [...text].map((_, i) => i * 8),
};

function cluster(id: string, start: number, end: number, dominant: string | null, reactionsCount: number) {
  return {
    id,
    messageId: 'm1',
    start,
    end,
    quote: text.slice(start, end),
    popularity: 1,
    memberReactions: dominant ? { [dominant]: reactionsCount } : {},
    visitorReactions: {},
    reactionsCount,
    commentsCount: 1,
    peopleCount: 1,
    fragmentsCount: 1,
    mine: null,
    myFragmentId: null,
    decisionId: null,
    dominant,
  } satisfies FragmentCluster;
}

const clusters = [
  cluster('heart', 0, 6, '❤️', 3),
  cluster('comments', 7, 13, null, 0),
  cluster('other', 14, 19, '🤔', 3),
];

function fills() {
  return screen
    .getAllByTestId('cluster-highlight')
    .map((piece) => StyleSheet.flatten(piece.props.style).backgroundColor as string);
}

beforeEach(() => mockPattern.mockClear());

describe('ClusterLayer', () => {
  it('paints each cluster in its leader colour and keeps comment-only clusters neutral', async () => {
    await render(<ClusterLayer geometry={geometry} clusters={clusters} isOwn={false} part="fill" />);

    const neutral = Colors.light.clusterHighlight;

    expect(fills()).toEqual([
      clusterTone(clusters[0], 'light', false, neutral).fill,
      neutral,
      clusterTone(clusters[2], 'light', false, neutral).fill,
    ]);
  });

  it('draws silhouettes only for clusters with reactions, each with its own emoji', async () => {
    await render(<ClusterLayer geometry={geometry} clusters={clusters} isOwn={false} part="fill" />);

    const { groups } = mockPattern.mock.calls.at(-1)?.[0] as ClusterPatternProps;

    expect(groups.map((group) => [group.clusterId, group.emoji])).toEqual([
      ['heart', '❤️'],
      ['other', '🤔'],
    ]);
    expect(groups.every((group) => group.pieces.every((piece) => piece.clusterId === group.clusterId))).toBe(
      true,
    );
  });

  it('uses the own-bubble palette in my bubble', async () => {
    await render(<ClusterLayer geometry={geometry} clusters={clusters} isOwn part="fill" />);

    expect(fills()[0]).toBe(
      clusterTone(clusters[0], 'light', true, Colors.light.clusterHighlightOnPrimary).fill,
    );
    expect(fills()[1]).toBe(Colors.light.clusterHighlightOnPrimary);
  });

  it('opens the cluster panel from the tap layer and draws nothing there', async () => {
    const onOpen = jest.fn();

    await render(
      <ClusterLayer geometry={geometry} clusters={clusters} isOwn={false} part="hits" onOpen={onOpen} />,
    );

    await fireEvent.press(screen.getByTestId('cluster-hit-other'));

    expect(onOpen).toHaveBeenCalledWith(clusters[2]);
    expect(screen.queryByTestId('cluster-highlight')).toBeNull();
    expect(mockPattern).not.toHaveBeenCalled();
  });
});
