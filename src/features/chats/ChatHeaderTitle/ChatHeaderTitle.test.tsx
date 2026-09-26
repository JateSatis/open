import { fireEvent, render } from '@testing-library/react-native';

import { ChatHeaderTitle } from './index';

import { useConnectionStatus } from '@/features/connection/useConnectionStatus';

jest.mock('@/features/connection/useConnectionStatus', () => ({
  useConnectionStatus: jest.fn(),
}));

const useConnectionStatusMock = useConnectionStatus as jest.Mock;

beforeEach(() => {
  useConnectionStatusMock.mockReturnValue('online');
});

describe('ChatHeaderTitle', () => {
  it('shows the counterpart status and opens their profile on tap', async () => {
    const onPress = jest.fn();

    const { getByText, getByLabelText } = await render(
      <ChatHeaderTitle title="Анна" subtitle="в отпуске" onPress={onPress} />,
    );

    expect(getByText('в отпуске')).toBeTruthy();
    await fireEvent.press(getByLabelText('Профиль: Анна'));
    expect(onPress).toHaveBeenCalled();
  });

  it('talks about the connection while offline', async () => {
    useConnectionStatusMock.mockReturnValue('offline');

    const { getByText, queryByText } = await render(
      <ChatHeaderTitle title="Анна" subtitle="в отпуске" onPress={jest.fn()} />,
    );

    expect(getByText('Нет сети')).toBeTruthy();
    expect(queryByText('в отпуске')).toBeNull();
  });
});
