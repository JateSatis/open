import { router } from '@/navigation';
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

export function AccountScreen() {
  const onOpenPrivacy = () => router.push({ name: 'Privacy' });
  return (
    <Screen scrollable edges={['bottom']} contentContainerStyle={styles.content}>
      <SettingsSection title="Настройки">
        <SettingsRow
          testID="account-privacy"
          title="Конфиденциальность и безопасность"
          onPress={onOpenPrivacy}
        />
      </SettingsSection>
      <BirthDateSection />
      <SignInMethods />
      <DeviceList />
      <AccountActions />
    </Screen>
  );
}
