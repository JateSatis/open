import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PageBar, PlainPageBar } from './index';

import { useConnectionStatus } from '@/features/connection/useConnectionStatus';

jest.mock('@/features/connection/useConnectionStatus', () => ({
  useConnectionStatus: jest.fn(() => 'online'),
}));

describe('PageBar', () => {
  it('goes back from the arrow and shows the title and the right side', async () => {
    const onBack = jest.fn();

    await render(
      <PageBar onBack={onBack} right={<Text>Меню</Text>}>
        <Text>Plany</Text>
      </PageBar>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Назад' }));

    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText('Plany')).toBeTruthy();
    expect(screen.getByText('Меню')).toBeTruthy();
  });

  it('has no arrow without onBack', async () => {
    await render(
      <PageBar>
        <Text>Выбрано: 2</Text>
      </PageBar>,
    );

    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull();
  });

  it('the placeholder bar tells about the connection while it is down', async () => {
    jest.mocked(useConnectionStatus).mockReturnValue('offline');

    await render(<PlainPageBar title="Чат" onBack={jest.fn()} />);

    expect(screen.getByText('Нет сети')).toBeTruthy();
    expect(screen.queryByText('Чат')).toBeNull();
  });
});
