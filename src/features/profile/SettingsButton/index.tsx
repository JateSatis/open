import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Шестерёнка в шапке своего профиля — вход на экран «Аккаунт». */
export function SettingsButton() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Аккаунт"
      hitSlop={12}
      onPress={() => router.push('/profile/account')}
    >
      <SymbolView
        name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
        size={Spacing.four}
        tintColor={theme.text}
      />
    </Pressable>
  );
}
