import { fireEvent, render, screen } from '@testing-library/react-native';

import { CommentsButton } from '.';

import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';

describe('CommentsButton', () => {
  it('shows the count and opens comments on tap', async () => {
    const onPress = jest.fn();

    await render(<CommentsButton tone="other" count={12} onPress={onPress} />);

    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByLabelText('Комментарии: 12 комментариев')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('comments-button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows just the icon with no comments yet', async () => {
    await render(<CommentsButton tone="other" count={0} onPress={jest.fn()} />);

    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByLabelText('Комментарии')).toBeTruthy();
  });

  it('only shows the count in the copy of the bubble inside the menu', async () => {
    await render(<CommentsButton tone="other" count={3} />);

    expect(screen.getByTestId('comments-button').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });
});

describe('commentsCountLabel', () => {
  it.each([
    [1, '1 комментарий'],
    [3, '3 комментария'],
    [5, '5 комментариев'],
    [11, '11 комментариев'],
    [21, '21 комментарий'],
    [112, '112 комментариев'],
  ])('%i → %s', (count, label) => {
    expect(commentsCountLabel(count)).toBe(label);
  });
});

describe('quiet CommentsButton', () => {
  it('stays tappable — a member can still write the first comment', async () => {
    const onPress = jest.fn();

    await render(<CommentsButton tone="own" count={0} quiet onPress={onPress} />);
    await fireEvent.press(screen.getByLabelText('Комментарии'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
