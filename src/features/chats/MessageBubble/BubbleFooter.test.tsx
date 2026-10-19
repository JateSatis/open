import { render, screen, within } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { BubbleFooter } from './BubbleFooter';

/** Тексты строки слева направо — в порядке дерева. */
function order(testID: string): string[] {
  return within(screen.getByTestId(testID))
    .getAllByText(/.+/)
    .map((node) => String(node.props.children));
}

describe('BubbleFooter', () => {
  it('puts time on the left and views on the right, with nothing between them', async () => {
    await render(
      <BubbleFooter
        meta={<Text>14:45</Text>}
        reactions={null}
        views={<Text>👁 12</Text>}
        visitors={null}
      />,
    );

    expect(order('bubble-footer-info')).toEqual(['14:45', '👁 12']);
    expect(screen.queryByTestId('bubble-footer-reactions')).toBeNull();
  });

  // Полоска статуса — всегда последняя строка: реакции над ней, а не в ней.
  it('stacks member reactions, then visitors, then the status line at the very bottom', async () => {
    await render(
      <View testID="bubble">
        <BubbleFooter
          meta={<Text>14:45</Text>}
          reactions={<Text>👍</Text>}
          views={<Text>👁 12</Text>}
          visitors={<Text testID="visitors">🔥 1</Text>}
        />
      </View>,
    );

    expect(order('bubble-footer-info')).toEqual(['14:45', '👁 12']);
    expect(order('bubble')).toEqual(['👍', '🔥 1', '14:45', '👁 12']);
  });
});
