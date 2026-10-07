import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Pressable } from 'react-native';

import { LargeReactionRow, VisitorReactions, type BubbleReactionsProps } from '.';

import type { MessageReactions as Reactions } from '@/api/reactionCounts';

const ann = { userId: 'ann', audience: 'member' as const, name: 'Аня', avatarUrl: null };
const bob = { userId: 'bob', audience: 'member' as const, name: 'Боб', avatarUrl: null };
const guest = { userId: 'guest', audience: 'visitor' as const, name: 'Гость', avatarUrl: null };

const reactions: Reactions = {
  members: { '👍': 1, '🔥': 5, '😁': 2, '❤️': 3 },
  visitors: { '👀': 12, '🎉': 3 },
  mine: null,
  reactors: { '👍': [ann], '😁': [ann, bob] },
};

let seq = 0;

function props(overrides: Partial<BubbleReactionsProps> = {}): BubbleReactionsProps {
  seq += 1;

  return {
    memoryKey: `message-${seq}`,
    reactions,
    tone: 'other',
    layout: 'split',
    audience: 'member',
    onToggle: jest.fn(),
    ...overrides,
  };
}

function rowOrder(): string[] {
  return within(screen.getByTestId('member-reactions'))
    .getAllByRole('button')
    .map((badge) => badge.props.accessibilityLabel);
}

describe('LargeReactionRow', () => {
  it('puts my reaction first, then the rest by popularity', async () => {
    await render(
      <LargeReactionRow
        {...props({ reactions: { ...reactions, mine: { emoji: '👍', audience: 'member' } } })}
      />,
    );

    expect(rowOrder()).toEqual(['👍 1', '🔥 5', '❤️ 3', '😁 2']);
    expect(screen.getByTestId('reaction-chip-👍').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('shows a count, one avatar or two avatars by how many people reacted', async () => {
    await render(<LargeReactionRow {...props()} />);

    expect(within(screen.getByTestId('reaction-chip-🔥')).getByText('5')).toBeTruthy();
    expect(within(screen.getByTestId('reaction-people-👍')).getAllByLabelText(/./)).toHaveLength(1);
    expect(within(screen.getByTestId('reaction-people-😁')).getAllByLabelText(/./)).toHaveLength(2);
    expect(within(screen.getByTestId('reaction-chip-😁')).queryByText('2')).toBeNull();
  });

  it('falls back to the count while the people do not match it', async () => {
    await render(
      <LargeReactionRow {...props({ reactions: { ...reactions, reactors: { '😁': [ann] } } })} />,
    );

    expect(within(screen.getByTestId('reaction-chip-😁')).getByText('2')).toBeTruthy();
  });

  it('prefers fresh avatars of chat participants', async () => {
    await render(
      <LargeReactionRow
        {...props({
          resolvePerson: (userId) =>
            userId === 'ann' ? { name: 'Анна Свежая', avatarUrl: null } : undefined,
        })}
      />,
    );

    expect(
      within(screen.getByTestId('reaction-people-👍')).getByLabelText('Анна Свежая'),
    ).toBeTruthy();
  });

  it('a member taps to take off their own reaction or to set another', async () => {
    const onToggle = jest.fn();

    await render(<LargeReactionRow {...props({ onToggle })} />);
    await fireEvent.press(screen.getByTestId('reaction-chip-🔥'));

    expect(onToggle).toHaveBeenCalledWith('🔥');
  });

  it('a visitor tapping a member reaction changes nothing and does not open the menu', async () => {
    const onToggle = jest.fn();
    const onBubble = jest.fn();

    await render(
      <Pressable testID="bubble" onPress={onBubble}>
        <LargeReactionRow {...props({ audience: 'visitor', onToggle })} />
      </Pressable>,
    );
    await fireEvent.press(screen.getByTestId('reaction-chip-🔥'));

    expect(onToggle).not.toHaveBeenCalled();
    expect(onBubble).not.toHaveBeenCalled();
  });

  it('nothing is tappable in the copy of the bubble', async () => {
    await render(<LargeReactionRow {...props({ onToggle: undefined })} />);

    expect(screen.getByTestId('reaction-chip-🔥').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('draws nothing without member reactions', async () => {
    await render(<LargeReactionRow {...props({ reactions: { ...reactions, members: {} } })} />);

    expect(screen.queryByTestId('member-reactions')).toBeNull();
  });
});

describe('one row of a comment', () => {
  const comment: Reactions = {
    members: { '👍': 1 },
    visitors: { '👍': 1, '😁': 4 },
    mine: { emoji: '👍', audience: 'visitor' },
    reactors: { '👍': [ann, guest] },
  };

  it('adds visitors to members, mine first, two people under a shared reaction', async () => {
    await render(<LargeReactionRow {...props({ reactions: comment, layout: 'merged' })} />);

    expect(rowOrder()).toEqual(['👍 2', '😁 4']);
    expect(within(screen.getByTestId('reaction-people-👍')).getAllByLabelText(/./)).toHaveLength(2);
  });

  it('a visitor taps any reaction of a comment', async () => {
    const onToggle = jest.fn();

    await render(
      <LargeReactionRow
        {...props({ reactions: comment, layout: 'merged', audience: 'visitor', onToggle })}
      />,
    );
    await fireEvent.press(screen.getByTestId('reaction-chip-😁'));

    expect(onToggle).toHaveBeenCalledWith('😁');
  });

  it('has no visitors line', async () => {
    await render(<VisitorReactions {...props({ reactions: comment, layout: 'merged' })} />);

    expect(screen.queryByTestId('visitor-reactions')).toBeNull();
  });
});

describe('VisitorReactions', () => {
  it('shows small reactions by popularity, with no separators between them', async () => {
    await render(<VisitorReactions {...props()} />);

    const line = screen.getByTestId('visitor-reactions');

    expect(within(line).getByLabelText('Зрители: 👀 12')).toBeTruthy();
    expect(within(line).queryByText('·')).toBeNull();
    expect(
      within(line)
        .getAllByLabelText(/^Зрители/)
        .map((item) => item.props.accessibilityLabel),
    ).toEqual(['Зрители: 👀 12', 'Зрители: 🎉 3']);
  });

  it('marks my visitor reaction', async () => {
    await render(
      <VisitorReactions
        {...props({ reactions: { ...reactions, mine: { emoji: '🎉', audience: 'visitor' } } })}
      />,
    );

    expect(screen.getByTestId('visitor-reaction-🎉').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('taps on the line never set or take off a reaction', async () => {
    const onToggle = jest.fn();

    await render(<VisitorReactions {...props({ audience: 'visitor', onToggle })} />);
    await fireEvent.press(screen.getByTestId('visitor-reaction-👀'));

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('draws nothing without visitor reactions', async () => {
    await render(<VisitorReactions {...props({ reactions: { ...reactions, visitors: {} } })} />);

    expect(screen.queryByTestId('visitor-reactions')).toBeNull();
  });
});
