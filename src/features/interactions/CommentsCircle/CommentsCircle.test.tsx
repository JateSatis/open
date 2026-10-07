import { fireEvent, render, screen } from '@testing-library/react-native';

import { CommentsCircle } from '.';

import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';

describe('CommentsCircle', () => {
  it('shows the count and opens comments on tap', async () => {
    const onPress = jest.fn();

    await render(<CommentsCircle count={12} onPress={onPress} />);

    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByLabelText('Комментарии: 12 комментариев')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('comments-circle'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows just the icon with no comments yet', async () => {
    await render(<CommentsCircle count={0} onPress={jest.fn()} />);

    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByLabelText('Комментарии')).toBeTruthy();
  });

  it('shortens thousands', async () => {
    await render(<CommentsCircle count={1234} onPress={jest.fn()} />);

    expect(screen.getByText('1,2K')).toBeTruthy();
  });

  it('only shows the count in a copy of the bubble', async () => {
    await render(<CommentsCircle count={3} />);

    expect(screen.getByTestId('comments-circle').props.accessibilityState).toEqual(
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
