import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BubbleFooter } from './BubbleFooter';

async function layout(testID: string, width: number) {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 28 } },
  });
}

/** Тексты строки слева направо — в порядке дерева. */
function order(testID: string): string[] {
  return within(screen.getByTestId(testID))
    .getAllByText(/.+/)
    .map((node) => String(node.props.children));
}

async function renderFooter(
  contentWidth: number,
  quiet = false,
  layoutKey?: string,
  extra: { members?: boolean; visitors?: boolean } = {},
) {
  return render(
    <BubbleFooter
      members={extra.members === false ? null : <Text>👍 2</Text>}
      visitors={extra.visitors ? <Text>🔥 1</Text> : null}
      comments={<Text>💬 4</Text>}
      quiet={quiet}
      meta={<Text>14:45</Text>}
      views={<Text>👁 12</Text>}
      contentWidth={contentWidth}
      layoutKey={layoutKey}
    />,
  );
}

describe('BubbleFooter', () => {
  it('puts the comments button next to the reactions when both fit the bubble', async () => {
    await renderFooter(300);

    await layout('bubble-footer-chips-content', 120);
    await layout('bubble-footer-button', 60);
    await layout('bubble-footer-meta', 50);

    expect(within(screen.getByTestId('bubble-footer-chips')).getByText('💬 4')).toBeTruthy();
    expect(within(screen.getByTestId('bubble-footer-info')).queryByText('💬 4')).toBeNull();
  });

  it('moves the button down to the time when it does not fit next to the reactions', async () => {
    await renderFooter(150);

    await layout('bubble-footer-chips-content', 120);
    await layout('bubble-footer-button', 60);
    await layout('bubble-footer-meta', 50);

    expect(within(screen.getByTestId('bubble-footer-info')).getByText('💬 4')).toBeTruthy();
    expect(within(screen.getByTestId('bubble-footer-chips')).queryByText('💬 4')).toBeNull();
  });

  it('keeps the quiet button on the line with the time even if there is room', async () => {
    await renderFooter(300, true);

    await layout('bubble-footer-chips-content', 120);
    await layout('bubble-footer-button', 20);
    await layout('bubble-footer-meta', 50);

    expect(within(screen.getByTestId('bubble-footer-info')).getByText('💬 4')).toBeTruthy();
  });

  it('a fresh copy of the bubble is laid out like the original from its first frame', async () => {
    const original = await renderFooter(300, false, 'message-copy');
    await layout('bubble-footer-chips-content', 120);
    await layout('bubble-footer-button', 60);
    await layout('bubble-footer-meta', 50);
    await original.unmount();

    // Копия облачка (над шитом, в меню): замеров у неё ещё не было.
    await renderFooter(300, false, 'message-copy');

    expect(within(screen.getByTestId('bubble-footer-chips')).getByText('💬 4')).toBeTruthy();
  });

  it('время — слева, просмотры — справа, кнопка комментариев правее всех', async () => {
    await renderFooter(300, false, undefined, { members: false, visitors: true });

    expect(order('bubble-footer-info')).toEqual(['14:45', '🔥 1', '👁 12', '💬 4']);
  });

  it('рядом с чипами кнопка стоит справа от них', async () => {
    await renderFooter(300);

    await layout('bubble-footer-chips-content', 120);
    await layout('bubble-footer-button', 60);
    await layout('bubble-footer-meta', 50);

    expect(order('bubble-footer-chips')).toEqual(['👍 2', '💬 4']);
  });

  it('просмотры входят в ширину нижней строки при выборе места кнопки', async () => {
    // Содержимое узкое, но нижняя строка со временем и просмотрами широкая —
    // облачко и так будет её ширины, кнопке рядом с чипами хватает места.
    await renderFooter(100);

    await layout('bubble-footer-chips-content', 100);
    await layout('bubble-footer-button', 60);
    await layout('bubble-footer-meta', 60);
    await layout('bubble-footer-views', 120);

    expect(within(screen.getByTestId('bubble-footer-chips')).getByText('💬 4')).toBeTruthy();
  });

  it('without a key a fresh footer waits for its own measurements', async () => {
    await renderFooter(300);

    expect(within(screen.getByTestId('bubble-footer-info')).getByText('💬 4')).toBeTruthy();
  });
});
