import { act, render, screen } from '@testing-library/react-native';

import { ConnectionTitle } from './index';

import {
  reportDeviceNetwork,
  reportRealtimeDown,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';

beforeEach(() => {
  resetConnectionState();
});

describe('ConnectionTitle', () => {
  it('shows the screen name while the connection holds', async () => {
    reportRealtimeJoined();

    await render(<ConnectionTitle title="Чаты" />);

    expect(screen.getByText('Чаты')).toBeTruthy();
  });

  it('replaces the name with the state of a lost connection', async () => {
    reportRealtimeJoined();

    await render(<ConnectionTitle title="Чаты" />);

    await act(() => reportDeviceNetwork(false));

    expect(screen.getByText('Нет сети')).toBeTruthy();
    expect(screen.queryByText('Чаты')).toBeNull();
  });

  it('says it is reconnecting while the socket is coming back', async () => {
    reportRealtimeJoined();

    await render(<ConnectionTitle title="Чаты" />);

    await act(() => reportRealtimeDown());

    expect(screen.getByText('Подключение…')).toBeTruthy();
  });

  it('returns the name once the connection is back', async () => {
    reportDeviceNetwork(false);

    await render(<ConnectionTitle title="Чаты" />);
    expect(screen.getByText('Нет сети')).toBeTruthy();

    await act(() => {
      reportDeviceNetwork(true);
      reportRealtimeJoined();
    });

    expect(screen.getByText('Чаты')).toBeTruthy();
  });
});
