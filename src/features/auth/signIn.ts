import {
  GoogleSignin,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';

import { describeAuthError, errorCodeOf, signInMessages } from './signInErrors';

import { supabase } from '@/api/supabase';

export type SignInProvider = 'google' | 'apple';

export type SignInResult =
  | { status: 'success' }
  /** The user dismissed the provider sheet — not an error, nothing to show. */
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

type GoogleSignInConfig = {
  webClientId?: string;
  iosClientId?: string;
};

/** Apple's own cancellation code; the module rejects instead of resolving. */
const APPLE_CANCELLED = 'ERR_REQUEST_CANCELED';

let googleConfigured = false;

function readGoogleConfig(): GoogleSignInConfig {
  const extra = Constants.expoConfig?.extra as { googleSignIn?: GoogleSignInConfig } | undefined;

  return extra?.googleSignIn ?? {};
}

function configureGoogle(config: GoogleSignInConfig) {
  if (googleConfigured) {
    return;
  }

  GoogleSignin.configure({
    webClientId: config.webClientId,
    iosClientId: config.iosClientId,
    scopes: ['profile', 'email'],
  });
  googleConfigured = true;
}

async function exchangeIdToken(provider: SignInProvider, token: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithIdToken({ provider, token });

  if (error) {
    return { status: 'error', message: describeAuthError(error) };
  }

  // The session lands in the store through onAuthStateChange, so nothing here
  // has to push it anywhere — routing reacts on its own.
  return { status: 'success' };
}

export async function signInWithGoogle(): Promise<SignInResult> {
  const config = readGoogleConfig();

  // The id token's audience is the web client id; without it Supabase would
  // reject every token, so fail early with something actionable.
  if (!config.webClientId) {
    return { status: 'error', message: signInMessages.googleNotConfigured };
  }

  try {
    configureGoogle(config);
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      return { status: 'cancelled' };
    }

    const idToken = response.data.idToken;

    if (!idToken) {
      return { status: 'error', message: signInMessages.missingToken };
    }

    return await exchangeIdToken('google', idToken);
  } catch (error) {
    switch (errorCodeOf(error)) {
      case statusCodes.SIGN_IN_CANCELLED:
        return { status: 'cancelled' };
      case statusCodes.IN_PROGRESS:
        return { status: 'error', message: signInMessages.inProgress };
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return { status: 'error', message: signInMessages.googlePlayServices };
      default:
        return { status: 'error', message: describeAuthError(error) };
    }
  }
}

export async function signInWithApple(): Promise<SignInResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { status: 'error', message: signInMessages.missingToken };
    }

    return await exchangeIdToken('apple', credential.identityToken);
  } catch (error) {
    if (errorCodeOf(error) === APPLE_CANCELLED) {
      return { status: 'cancelled' };
    }

    return { status: 'error', message: describeAuthError(error) };
  }
}
