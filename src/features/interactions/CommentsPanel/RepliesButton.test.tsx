import { fireEvent, render, screen } from '@testing-library/react-native';

import { RepliesButton, repliesLabel } from './RepliesButton';
import { ThreadGapRow } from './ThreadGapRow';

describe('repliesLabel', () => {
  it.each([
    [1, '1 ответ'],
    [2, '2 ответа'],
    [3, '3 ответа'],
    [5, '5 ответов'],
    [11, '11 ответов'],
    [21, '21 ответ'],
    [112, '112 ответов'],
  ])('%i → «%s»', (count, label) => {
    expect(repliesLabel(count)).toBe(label);
  });
});

describe('RepliesButton', () => {
  it('shows the whole label on one line and opens the thread', async () => {
    const onPress = jest.fn();

    await render(<RepliesButton count={3} isOwn={false} onPress={onPress} />);

    const label = screen.getByText('3 ответа');

    // Одна строка: перенос второго слова срезался высотой кнопки — «3 ›».
    expect(label.props.numberOfLines).toBe(1);

    await fireEvent.press(screen.getByLabelText('Показать 3 ответа'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('ThreadGapRow', () => {
  it('shows «Показать ещё N ответов» on one line', async () => {
    await render(<ThreadGapRow hidden={11} isLoading={false} onPress={jest.fn()} />);

    expect(screen.getByText('Показать ещё 11 ответов').props.numberOfLines).toBe(1);
  });
});
