import { act, render, screen } from '@testing-library/react-native';

import { ConnectionBanner } from './index';

import {
  reportDeviceNetwork,
  reportRealtimeDown,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';

beforeEach(() => {
  jest.useFakeTimers();
  resetConnectionState();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ConnectionBanner', () => {
  it('says nothing while the connection holds', async () => {
    reportRealtimeJoined();

    await render(<ConnectionBanner />);

    expect(screen.queryByText('Нет сети')).toBeNull();
    expect(screen.queryByText('Подключение…')).toBeNull();
  });

  it('shows «Нет сети» when the device loses the network', async () => {
    reportRealtimeJoined();

    await render(<ConnectionBanner />);
    await act(() => reportDeviceNetwork(false));

    expect(screen.getByText('Нет сети')).toBeTruthy();
  });

  it('says it is reconnecting while the socket is coming back', async () => {
    reportRealtimeJoined();

    await render(<ConnectionBanner />);
    await act(() => reportRealtimeDown());

    expect(screen.getByText('Подключение…')).toBeTruthy();
  });

  it('goes away once the connection is back', async () => {
    reportDeviceNetwork(false);

    await render(<ConnectionBanner />);
    expect(screen.getByText('Нет сети')).toBeTruthy();

    await act(() => {
      reportDeviceNetwork(true);
      reportRealtimeJoined();
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Нет сети')).toBeNull();
  });
});
