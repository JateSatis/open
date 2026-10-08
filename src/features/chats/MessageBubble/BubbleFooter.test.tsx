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

  it('puts member reactions between the status and the views, visitors below the row', async () => {
    await render(
      <BubbleFooter
        meta={<Text>14:45</Text>}
        reactions={<Text>👍</Text>}
        views={<Text>👁 12</Text>}
        visitors={<Text testID="visitors">🔥 1</Text>}
      />,
    );

    expect(order('bubble-footer-info')).toEqual(['14:45', '👍', '👁 12']);
    expect(within(screen.getByTestId('bubble-footer-info')).queryByText('🔥 1')).toBeNull();
    expect(screen.getByTestId('visitors')).toBeTruthy();
  });
});
