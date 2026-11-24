import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { requestSelection } from '@/api/screenRequest';
import { activateProviderSession } from './accountChoice';
import { Text } from '@/components/Text';
import {
  signInWithApple,
  signInWithGoogle,
  type SignInProvider,
} from '@/features/auth/signIn';
import { useAppleSignInAvailable } from '@/features/auth/useAppleSignInAvailable';
import { Spacing } from '@/theme';

export function ProviderButtons() {
  const selection = requestSelection();
  const [pendingProvider, setPendingProvider] = useState<SignInProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isAppleAvailable = useAppleSignInAvailable();

  async function run(provider: SignInProvider) {
    setErrorMessage(null);
    setPendingProvider(provider);

    const signIn = provider === 'google' ? signInWithGoogle : signInWithApple;
    const result = await signIn(activateProviderSession(selection));

    setPendingProvider(null);

    if (result.status === 'error') {
      setErrorMessage(result.message);
    }
  }

  const isBusy = pendingProvider !== null;

  return (
    <View style={styles.actions}>
      <Button
        label="Продолжить с Google"
        loading={pendingProvider === 'google'}
        disabled={isBusy}
        onPress={() => run('google')}
      />

      {isAppleAvailable ? (
        <Button
          label="Продолжить с Apple"
          variant="secondary"
          loading={pendingProvider === 'apple'}
          disabled={isBusy}
          onPress={() => run('apple')}
        />
      ) : null}

      {errorMessage !== null ? (
        <Text color="danger" variant="small" accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
});
