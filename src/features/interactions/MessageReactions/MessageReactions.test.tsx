import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { MessageReactions } from '.';

import type { MessageReactions as Reactions } from '@/api/reactionCounts';

const both: Reactions = {
  members: { '👍': 2, '🔥': 5 },
  visitors: { '😁': 3, '👀': 12 },
  mine: null,
};

describe('MessageReactions', () => {
  it('draws nothing when there are no reactions', async () => {
    await render(
      <MessageReactions reactions={{ members: {}, visitors: {}, mine: null }} tone="other" />,
    );

    expect(screen.queryByTestId('message-reactions')).toBeNull();
  });

  it('keeps members and visitors in separate rows, visitors labelled as viewers', async () => {
    await render(<MessageReactions reactions={both} tone="other" />);

    const members = screen.getByTestId('member-reactions');
    const visitors = screen.getByTestId('visitor-reactions');

    expect(within(members).getByLabelText('🔥 5')).toBeTruthy();
    expect(within(members).getByLabelText('👍 2')).toBeTruthy();
    expect(within(members).queryByText('😁')).toBeNull();
    expect(within(visitors).getByText('зрители')).toBeTruthy();
    expect(within(visitors).getByLabelText('Зрители: 👀 12')).toBeTruthy();
    expect(within(visitors).queryByText('🔥')).toBeNull();
  });

  it('orders member chips by popularity', async () => {
    await render(<MessageReactions reactions={both} tone="other" />);

    const labels = within(screen.getByTestId('member-reactions'))
      .getAllByRole('button')
      .map((chip) => chip.props.accessibilityLabel);

    expect(labels).toEqual(['🔥 5', '👍 2']);
  });

  it('shows only a visitors row when members have not reacted', async () => {
    await render(
      <MessageReactions
        reactions={{ members: {}, visitors: { '😁': 1 }, mine: null }}
        tone="own"
      />,
    );

    expect(screen.queryByTestId('member-reactions')).toBeNull();
    expect(screen.getByTestId('visitor-reactions')).toBeTruthy();
  });

  it('marks my reaction in its row', async () => {
    await render(
      <MessageReactions
        reactions={{ ...both, mine: { emoji: '👀', audience: 'visitor' } }}
        tone="other"
      />,
    );

    expect(screen.getByTestId('visitor-reaction-👀').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('reaction-chip-🔥').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('a member toggles by tapping a member chip, but the visitors row does nothing', async () => {
    const onToggle = jest.fn();

    await render(
      <MessageReactions reactions={both} tone="other" audience="member" onToggle={onToggle} />,
    );

    await fireEvent.press(screen.getByTestId('reaction-chip-👍'));
    await fireEvent.press(screen.getByTestId('visitor-reaction-😁'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('👍');
  });

  it('a visitor toggles in the visitors row, but member chips do nothing', async () => {
    const onToggle = jest.fn();

    await render(
      <MessageReactions reactions={both} tone="other" audience="visitor" onToggle={onToggle} />,
    );

    await fireEvent.press(screen.getByTestId('reaction-chip-👍'));
    await fireEvent.press(screen.getByTestId('visitor-reaction-😁'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('😁');
  });

  it('nothing is tappable in the lifted copy of the bubble', async () => {
    await render(<MessageReactions reactions={both} tone="other" audience="member" />);

    expect(screen.getByTestId('reaction-chip-👍').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
