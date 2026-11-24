import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ProviderButtons } from '../ProviderButtons';
import { SavedAccounts } from '../SavedAccounts';
import { Spacing } from '@/theme';

export function SignInScreen() {
  return (
    <Screen scrollable>
      <View style={styles.intro}>
        <Text variant="title">Open</Text>
        <Text color="textSecondary">
          Мессенджер, в котором переписка публична: любой диалог может открыть и прочитать кто
          угодно.
        </Text>
      </View>

      <SavedAccounts />
      <ProviderButtons />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
