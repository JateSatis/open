import { fireEvent, render } from '@testing-library/react-native';

import { LoadFailed } from '.';

describe('LoadFailed', () => {
  it('говорит, что не удалось, и по «Повторить» начинает новую попытку', async () => {
    const onRetry = jest.fn();
    const { getByText } = await render(
      <LoadFailed message="Не удалось загрузить переписку" onRetry={onRetry} />,
    );

    expect(getByText('Не удалось загрузить переписку')).toBeTruthy();

    await fireEvent.press(getByText('Повторить'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
