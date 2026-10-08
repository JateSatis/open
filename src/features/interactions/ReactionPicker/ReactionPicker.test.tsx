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
    // Шире восьми клеток полоса не растёт: семь основных и кнопка.
    expect(pickerGeometry(1000).firstRow).toHaveLength(7);
  });

  it('with a full row offers only the reactions already there, strip and expand', async () => {
    const options = ALL_REACTIONS.slice(10, 30);

    await render(
      <ReactionPicker
        geometry={pickerGeometry(400, { options })}
        selected={null}
        expanded
        maxHeight={1000}
        onToggleExpanded={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    const shown = screen
      .getAllByRole('button')
      .map((button) => button.props.testID)
      .filter((id: string) => id.startsWith('reaction-option-'));

    expect(shown).toEqual(options.map((emoji) => `reaction-option-${emoji}`));
    expect(screen.getByTestId('reaction-picker-expand')).toBeTruthy();
  });

  it('a full visitors row is shown at once, without expanding, with counts', async () => {
    const options = ['👍', '🔥', '😁', '❤️', '🤔', '👀', '🎉'];
    const counts = { '👍': 2345, '🔥': 12, '😁': 1, '❤️': 3, '🤔': 4, '👀': 5, '🎉': 6 };

    await render(
      <ReactionPicker
        geometry={pickerGeometry(330, { options, counts, expandable: false })}
        selected={null}
        expanded={false}
        maxHeight={1000}
        onToggleExpanded={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('reaction-picker-expand')).toBeNull();
    expect(screen.getByLabelText('Реакция 👍, у зрителей 2,3K')).toBeTruthy();
    for (const emoji of options)
      expect(screen.getByTestId(`reaction-option-${emoji}`)).toBeTruthy();
  });

  it('counts widen their cells, and the strip still fits the screen', () => {
    const geometry = pickerGeometry(330, { counts: { '👍': 2345, '👎': 10 } });
    const strip = geometry.firstRow.reduce((sum, cell) => sum + cell.width, 0);

    expect(geometry.firstRow[0].count).toBe('2,3K');
    expect(strip + 40).toBeLessThanOrEqual(geometry.width);
    expect(geometry.width).toBeLessThanOrEqual(330);
  });
});
