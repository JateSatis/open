import { render, fireEvent } from '@testing-library/react-native';

import { Input } from '.';

describe('Input', () => {
  it('renders the label and reports text changes', async () => {
    const onChangeText = jest.fn();
    const { getByText, getByDisplayValue } = await render(
      <Input label="Email" value="" onChangeText={onChangeText} />,
    );

    expect(getByText('Email')).toBeTruthy();

    await fireEvent.changeText(getByDisplayValue(''), 'hi@open.app');

    expect(onChangeText).toHaveBeenCalledWith('hi@open.app');
  });

  it('shows the error message when given one', async () => {
    const { getByText } = await render(<Input value="" error="Required" />);

    expect(getByText('Required')).toBeTruthy();
  });

  it('shows a fixed suffix that is not part of the value', async () => {
    const onChangeText = jest.fn();
    const { getByText, getByDisplayValue } = await render(
      <Input value="news" suffix=".ch" onChangeText={onChangeText} />,
    );

    expect(getByText('.ch')).toBeTruthy();

    await fireEvent.changeText(getByDisplayValue('news'), 'news2');

    expect(onChangeText).toHaveBeenCalledWith('news2');
  });
});
