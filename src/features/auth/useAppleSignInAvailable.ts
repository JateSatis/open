import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Sign in with Apple exists on iOS 13+ only, so the button has to be hidden
 * everywhere else instead of failing when pressed.
 */
export function useAppleSignInAvailable(): boolean {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    let active = true;

    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) {
          setIsAvailable(available);
        }
      })
      .catch(() => {
        if (active) {
          setIsAvailable(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return isAvailable;
}
