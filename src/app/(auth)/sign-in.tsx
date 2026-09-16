import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  signInWithApple,
  signInWithGoogle,
  type SignInProvider,
  type SignInResult,
} from '@/features/auth/signIn';
import { useAppleSignInAvailable } from '@/features/auth/useAppleSignInAvailable';
import { Spacing } from '@/theme';

export default function SignInScreen() {
  const [pendingProvider, setPendingProvider] = useState<SignInProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isAppleAvailable = useAppleSignInAvailable();

  async function run(provider: SignInProvider, signIn: () => Promise<SignInResult>) {
    setErrorMessage(null);
    setPendingProvider(provider);

    const result = await signIn();

    setPendingProvider(null);

    if (result.status === 'error') {
      setErrorMessage(result.message);
    }

    // A success needs no navigation here: the session store picks the new
    // session up and the (auth) layout redirects.
  }

  const isBusy = pendingProvider !== null;

  return (
    <Screen>
      <View style={styles.intro}>
        <Text variant="title">Open</Text>
        <Text color="textSecondary">
          Мессенджер, в котором переписка публична: любой диалог может открыть и прочитать кто
          угодно.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Продолжить с Google"
          loading={pendingProvider === 'google'}
          disabled={isBusy}
          onPress={() => run('google', signInWithGoogle)}
        />

        {isAppleAvailable ? (
          <Button
            label="Продолжить с Apple"
            variant="secondary"
            loading={pendingProvider === 'apple'}
            disabled={isBusy}
            onPress={() => run('apple', signInWithApple)}
          />
        ) : null}

        {errorMessage !== null ? (
          <Text color="danger" variant="small" accessibilityRole="alert">
            {errorMessage}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.two,
  },
  actions: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
});
