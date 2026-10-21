import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/Screen';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { AccountActions } from '@/features/auth/AccountActions';
import { DeviceList } from '@/features/auth/DeviceList';
import { SignInMethods } from '@/features/auth/SignInMethods';
import { BirthDateSection } from '@/features/privacy/BirthDateSection';
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
      <SettingsSection title="Настройки">
        <SettingsRow
          testID="account-privacy"
          title="Конфиденциальность и безопасность"
          onPress={() => router.push('/profile/privacy')}
        />
      </SettingsSection>
      <BirthDateSection />
      <SignInMethods />
      <DeviceList />
      <AccountActions />
    </Screen>
  );
}
