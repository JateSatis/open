import { render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BubbleFooter } from './BubbleFooter';

/** Тексты строки слева направо — в порядке дерева. */
function order(testID: string): string[] {
  return within(screen.getByTestId(testID))
    .getAllByText(/.+/)
    .map((node) => String(node.props.children));
}

describe('BubbleFooter', () => {
  it('puts time on the left and views on the right of one bottom row', async () => {
    await render(
      <BubbleFooter
        members={null}
        visitors={null}
        meta={<Text>14:45</Text>}
        views={<Text>👁 12</Text>}
      />,
    );

    expect(order('bubble-footer-info')).toEqual(['14:45', '👁 12']);
    expect(screen.queryByTestId('bubble-footer-chips')).toBeNull();
  });

  it('keeps member chips on their own row and visitors after the time', async () => {
    await render(
      <BubbleFooter
        members={<Text>👍 2</Text>}
        visitors={<Text>🔥 1</Text>}
        meta={<Text>14:45</Text>}
        views={<Text>👁 12</Text>}
      />,
    );

    expect(order('bubble-footer-chips')).toEqual(['👍 2']);
    expect(order('bubble-footer-info')).toEqual(['14:45', '🔥 1', '👁 12']);
  });
});
