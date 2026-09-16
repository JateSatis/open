import { render, fireEvent } from '@testing-library/react-native';

import { Button } from '.';

describe('Button', () => {
  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button label="Continue" onPress={onPress} />);

    await fireEvent.press(getByText('Continue'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button label="Continue" onPress={onPress} disabled />);

    await fireEvent.press(getByText('Continue'));

    expect(onPress).not.toHaveBeenCalled();
  });
});
