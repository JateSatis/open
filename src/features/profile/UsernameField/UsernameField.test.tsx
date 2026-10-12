import { fireEvent, render, screen } from '@testing-library/react-native';

import { UsernameField } from '.';

describe('UsernameField', () => {
  it('shows the kind suffix to the right and none for a person', async () => {
    const { rerender } = await render(
      <UsernameField
        kind="group"
        value=""
        onChangeText={jest.fn()}
        availability={{ status: 'empty' }}
      />,
    );

    expect(screen.getByTestId('username-field-suffix')).toHaveTextContent('.di');

    await rerender(
      <UsernameField
        kind="profile"
        value=""
        onChangeText={jest.fn()}
        availability={{ status: 'empty' }}
      />,
    );

    expect(screen.queryByTestId('username-field-suffix')).toBeNull();
  });

  it('strips a pasted @ and the own suffix before reporting the value', async () => {
    const onChangeText = jest.fn();

    await render(
      <UsernameField
        kind="channel"
        value=""
        onChangeText={onChangeText}
        availability={{ status: 'empty' }}
      />,
    );
    await fireEvent.changeText(screen.getByTestId('username-field'), '@news.ch');

    expect(onChangeText).toHaveBeenCalledWith('news');
  });

  it('puts a server error above the live answer', async () => {
    await render(
      <UsernameField
        kind="group"
        value="team"
        onChangeText={jest.fn()}
        availability={{ status: 'available' }}
        error="Имя занято"
      />,
    );

    expect(screen.getByText('Имя занято')).toBeTruthy();
    expect(screen.queryByText('Имя свободно')).toBeNull();
  });

  it('says a taken name is taken and a free one is free', async () => {
    const { rerender } = await render(
      <UsernameField
        kind="profile"
        value="max"
        onChangeText={jest.fn()}
        availability={{ status: 'taken' }}
      />,
    );

    expect(screen.getByText('Имя занято')).toBeTruthy();

    await rerender(
      <UsernameField
        kind="profile"
        value="max"
        onChangeText={jest.fn()}
        availability={{ status: 'available' }}
      />,
    );

    expect(screen.getByText('Имя свободно')).toBeTruthy();
  });
});
