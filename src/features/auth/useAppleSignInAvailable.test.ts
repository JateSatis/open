import { renderHook, waitFor } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { useAppleSignInAvailable } from './useAppleSignInAvailable';

jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn() }));

const isAvailableAsync = AppleAuthentication.isAvailableAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  isAvailableAsync.mockResolvedValue(true);
});

describe('useAppleSignInAvailable', () => {
  it('reports availability on iOS', async () => {
    Platform.OS = 'ios';

    const { result } = await renderHook(() => useAppleSignInAvailable());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reports unavailable on iOS versions without Sign in with Apple', async () => {
    Platform.OS = 'ios';
    isAvailableAsync.mockResolvedValue(false);

    const { result } = await renderHook(() => useAppleSignInAvailable());

    expect(result.current).toBe(false);
  });

  it('never asks the Apple module on Android', async () => {
    Platform.OS = 'android';

    const { result } = await renderHook(() => useAppleSignInAvailable());

    expect(result.current).toBe(false);
    expect(isAvailableAsync).not.toHaveBeenCalled();
  });
});
