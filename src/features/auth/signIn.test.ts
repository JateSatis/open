import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';

import { signInWithApple, signInWithGoogle } from './signIn';
import { signInMessages } from './signInErrors';

import { supabase } from '@/api/supabase';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER',
  },
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
}));

jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  isAvailableAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { googleSignIn: { webClientId: 'web-client-id' } } } },
}));

jest.mock('@/api/supabase', () => ({
  supabase: { auth: { signInWithIdToken: jest.fn() } },
}));

const googleSignIn = GoogleSignin.signIn as jest.Mock;
const hasPlayServices = GoogleSignin.hasPlayServices as jest.Mock;
const appleSignInAsync = AppleAuthentication.signInAsync as jest.Mock;
const signInWithIdToken = supabase.auth.signInWithIdToken as jest.Mock;

function setGoogleConfig(config: { webClientId?: string }) {
  (Constants.expoConfig as unknown as { extra: { googleSignIn: unknown } }).extra.googleSignIn =
    config;
}

function errorWithCode(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  jest.clearAllMocks();
  setGoogleConfig({ webClientId: 'web-client-id' });
  hasPlayServices.mockResolvedValue(true);
  signInWithIdToken.mockResolvedValue({ data: {}, error: null });
});

describe('signInWithGoogle', () => {
  it('exchanges the Google id token for a Supabase session', async () => {
    googleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'success' });

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
    });
  });

  it('reports a dismissed sheet as cancelled rather than as an error', async () => {
    googleSignIn.mockResolvedValue({ type: 'cancelled', data: null });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('treats a thrown cancellation as cancelled too', async () => {
    googleSignIn.mockRejectedValue(errorWithCode(statusCodes.SIGN_IN_CANCELLED));

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
  });

  it('explains a missing Play Services install', async () => {
    hasPlayServices.mockRejectedValue(errorWithCode(statusCodes.PLAY_SERVICES_NOT_AVAILABLE));

    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: signInMessages.googlePlayServices,
    });
  });

  it('explains a lost connection instead of showing the raw error', async () => {
    googleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
    signInWithIdToken.mockResolvedValue({
      data: {},
      error: Object.assign(new Error('Network request failed'), {
        name: 'AuthRetryableFetchError',
      }),
    });

    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: signInMessages.network,
    });
  });

  it('falls back to a generic message when the server rejects the token', async () => {
    googleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google-id-token' } });
    signInWithIdToken.mockResolvedValue({ data: {}, error: new Error('Invalid audience') });

    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: signInMessages.generic,
    });
  });

  it('refuses to start when the build has no Google client id', async () => {
    setGoogleConfig({});

    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: signInMessages.googleNotConfigured,
    });
    expect(googleSignIn).not.toHaveBeenCalled();
  });

  it('reports a sign-in without an id token', async () => {
    googleSignIn.mockResolvedValue({ type: 'success', data: { idToken: null } });

    await expect(signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: signInMessages.missingToken,
    });
  });
});

describe('signInWithApple', () => {
  it('exchanges the Apple identity token for a Supabase session', async () => {
    appleSignInAsync.mockResolvedValue({ identityToken: 'apple-id-token' });

    await expect(signInWithApple()).resolves.toEqual({ status: 'success' });

    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-id-token',
    });
  });

  it('reports a dismissed Apple sheet as cancelled', async () => {
    appleSignInAsync.mockRejectedValue(errorWithCode('ERR_REQUEST_CANCELED'));

    await expect(signInWithApple()).resolves.toEqual({ status: 'cancelled' });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('explains a lost connection', async () => {
    appleSignInAsync.mockRejectedValue(new Error('Network request failed'));

    await expect(signInWithApple()).resolves.toEqual({
      status: 'error',
      message: signInMessages.network,
    });
  });

  it('reports a credential without an identity token', async () => {
    appleSignInAsync.mockResolvedValue({ identityToken: null });

    await expect(signInWithApple()).resolves.toEqual({
      status: 'error',
      message: signInMessages.missingToken,
    });
  });
});
