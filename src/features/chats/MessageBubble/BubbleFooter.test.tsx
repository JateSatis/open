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

  // Полоска статуса — всегда последняя строка: крупный ряд над ней, а
  // реакции зрителей — в ней, между временем и просмотрами.
  it('puts member reactions above the status line and visitors inside it, between time and views', async () => {
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

    expect(order('bubble-footer-info')).toEqual(['14:45', '🔥 1', '👁 12']);
    expect(order('bubble')).toEqual(['👍', '14:45', '🔥 1', '👁 12']);
    expect(order('bubble-footer-visitors')).toEqual(['🔥 1']);
  });
});
