import { fireEvent, render, screen } from '@testing-library/react-native';

import { FragmentQuote } from './index';

describe('FragmentQuote', () => {
  it('shows the quoted piece without a navigation handler', async () => {

    await render(<FragmentQuote text="какой-то другой уровень" isOwn={false} />);

    await fireEvent.press(screen.getByText('какой-то другой уровень'));

    expect(screen.getByTestId('comment-fragment-quote')).toBeDisabled();
    expect(screen.getByTestId('comment-fragment-quote').props.onPress).toBeUndefined();
  });

  it('shows exactly 100 characters of a long quote and an ellipsis', async () => {
    await render(<FragmentQuote text={'ы'.repeat(150)} isOwn />);

    expect(screen.getByText(`${'ы'.repeat(100)}…`)).toBeTruthy();
  });

  it('does not split an emoji on the hundredth character', async () => {
    await render(<FragmentQuote text={`${'ы'.repeat(99)}🏳️‍🌈 и дальше`} isOwn={false} />);

    expect(screen.getByText(`${'ы'.repeat(99)}🏳️‍🌈…`)).toBeTruthy();
  });

  it('says the message is deleted when the quote is gone with it', async () => {
    await render(<FragmentQuote text={null} isOwn={false} />);

    expect(screen.getByText('Сообщение удалено')).toBeTruthy();
  });
});
