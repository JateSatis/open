import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { pickerGeometry, ReactionPicker } from '.';

import { ALL_REACTIONS, PRIMARY_REACTIONS } from '@/features/interactions/reactionSet';

function Harness({ onSelect, selected = null }: { onSelect: jest.Mock; selected?: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ReactionPicker
      geometry={pickerGeometry(400)}
      selected={selected}
      expanded={expanded}
      maxHeight={1000}
      onToggleExpanded={() => setExpanded((value) => !value)}
      onSelect={onSelect}
    />
  );
}

describe('ReactionPicker', () => {
  it('starts as a strip: the primary reactions, then the expand button on the right', async () => {
    await render(<Harness onSelect={jest.fn()} />);

    const buttons = screen.getAllByRole('button').map((button) => button.props.testID);

    expect(buttons).toEqual([
      ...PRIMARY_REACTIONS.map((emoji) => `reaction-option-${emoji}`),
      'reaction-picker-expand',
    ]);
  });

  it('opens the whole set by the button on the right, below the strip', async () => {
    await render(<Harness onSelect={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('reaction-picker-expand'));

    for (const emoji of ALL_REACTIONS) {
      expect(screen.getByTestId(`reaction-option-${emoji}`)).toBeTruthy();
    }

    expect(screen.getByTestId('reaction-picker-expand').props.accessibilityState).toMatchObject({
      expanded: true,
    });

    // Кнопка закрывает первую полосу, остальной набор — под ней.
    const buttons = screen.getAllByRole('button').map((button) => button.props.testID);

    expect(buttons.indexOf('reaction-picker-expand')).toBe(PRIMARY_REACTIONS.length);
  });

  it('hands the tapped reaction over', async () => {
    const onSelect = jest.fn();

    await render(<Harness onSelect={onSelect} />);
    await fireEvent.press(screen.getByTestId('reaction-picker-expand'));
    await fireEvent.press(screen.getByTestId('reaction-option-🤯'));

    expect(onSelect).toHaveBeenCalledWith('🤯');
  });

  it('highlights my current reaction', async () => {
    await render(<Harness onSelect={jest.fn()} selected="🔥" />);

    expect(screen.getByLabelText('Снять реакцию 🔥').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('fits a narrow screen with fewer columns', () => {
    const narrow = pickerGeometry(300);

    expect(narrow.width).toBeLessThanOrEqual(300);
    expect(narrow.firstRow.length + narrow.rest.length).toBe(ALL_REACTIONS.length);
    expect(pickerGeometry(1000).columns).toBe(8);
  });
});
