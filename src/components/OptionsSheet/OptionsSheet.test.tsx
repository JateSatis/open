import { fireEvent, render } from '@testing-library/react-native';

import { OptionsSheet } from './index';

describe('OptionsSheet', () => {
  it('runs the chosen option and closes', async () => {
    const onPick = jest.fn();
    const onClose = jest.fn();

    const { getByText } = await render(
      <OptionsSheet visible options={[{ label: 'Снять фото', onPress: onPick }]} onClose={onClose} />,
    );
    await fireEvent.press(getByText('Снять фото'));

    expect(onClose).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalled();
  });

  it('closes without choosing on Отмена', async () => {
    const onPick = jest.fn();
    const onClose = jest.fn();

    const { getByText } = await render(
      <OptionsSheet visible options={[{ label: 'Снять фото', onPress: onPick }]} onClose={onClose} />,
    );
    await fireEvent.press(getByText('Отмена'));

    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
