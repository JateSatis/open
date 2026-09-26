import { StyleSheet } from 'react-native';

import { Screen } from '@/components/Screen';
import { AccountActions } from '@/features/auth/AccountActions';
import { DeviceList } from '@/features/auth/DeviceList';
import { SignInMethods } from '@/features/auth/SignInMethods';
import { Spacing } from '@/theme';

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingBottom: Spacing.five,
  },
});

export default function AccountScreen() {
  return (
    <Screen scrollable edges={['bottom']} contentContainerStyle={styles.content}>
      <SignInMethods />
      <DeviceList />
      <AccountActions />
    </Screen>
  );
}
