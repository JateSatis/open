import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SharedValue } from 'react-native-reanimated';

import { SegmentedControl } from '.';

const SEGMENTS = ['Посты', 'Попсы'] as const;
// Мок Reanimated отдаёт из `makeMutable` голый `{ value }`; бегунку нужен `get`.
const position = { value: 0, get: () => 0 } as unknown as SharedValue<number>;

describe('SegmentedControl', () => {
  it('shows no badges unless asked — same segments as before', async () => {
    await render(
      <SegmentedControl
        segments={SEGMENTS}
        position={position}
        selectedIndex={0}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Посты' })).toBeTruthy();
    expect(screen.queryByTestId('segment-badge-0')).toBeNull();
    expect(screen.queryByTestId('segment-badge-1')).toBeNull();
  });

  it('puts a count next to a segment, hides zero, caps at 99+', async () => {
    const onSelect = jest.fn();

    await render(
      <SegmentedControl
        segments={SEGMENTS}
        position={position}
        selectedIndex={0}
        onSelect={onSelect}
        badges={[0, 150]}
      />,
    );

    expect(screen.queryByTestId('segment-badge-0')).toBeNull();
    expect(screen.getByText('99+')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: 'Попсы, непрочитанных: 150' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
