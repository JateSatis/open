import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BubbleFooter } from './BubbleFooter';

async function layout(testID: string, width: number) {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 28 } },
  });
}

async function renderFooter(contentWidth: number, quiet = false, layoutKey?: string) {
  return render(
    <BubbleFooter
      isOwn={false}
      members={<Text>👍 2</Text>}
      visitors={null}
      comments={<Text>💬 4</Text>}
      quiet={quiet}
      meta={<Text>14:45</Text>}
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

  it('without a key a fresh footer waits for its own measurements', async () => {
    await renderFooter(300);

    expect(within(screen.getByTestId('bubble-footer-info')).getByText('💬 4')).toBeTruthy();
  });
});
