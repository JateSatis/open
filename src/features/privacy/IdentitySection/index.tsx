import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import {
  AliasLimitError,
  type VisibilitySetting,
  type PrivacySettings,
  type Visibility,
} from '@/api/privacy';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { Text } from '@/components/Text';
import { useRegenerateIdentityAlias } from '@/features/privacy/queries';
import { VisibilityChoice } from '@/features/privacy/VisibilityChoice';
import { useTheme } from '@/hooks/use-theme';

export type IdentitySectionProps = {
  settings: PrivacySettings;
  onChange: (setting: VisibilitySetting) => (value: Visibility) => void;
};

/**
 * Группа «Идентичность»: кто видит имя и username, кто видит имя в моих
 * диалогах, и каким псевдонимом я показан остальным. Пояснения не обещают
 * анонимности: скрывается имя, а не то, что человек пишет.
 */
export function IdentitySection({ settings, onChange }: IdentitySectionProps) {
  const theme = useTheme();
  const regenerate = useRegenerateIdentityAlias();
  const limitReached = regenerate.error instanceof AliasLimitError;

  return (
    <View style={styles.group}>
      <Text variant="bodyBold" style={styles.groupTitle}>
        Идентичность
      </Text>
      <VisibilityChoice
        testID="privacy-identity"
        title="Кто видит моё имя и username"
        footer="Остальные видят вместо имени псевдоним, не видят username, «О себе» и статус и не найдут вас по настоящему имени и username — только по псевдониму. Это скрывает имя, но не то, что вы пишете: переписка остаётся публичной."
        value={settings.identityVisibility}
        onChange={onChange('profile_identity_masking')}
      />
      <VisibilityChoice
        testID="privacy-dialogue-name"
        title="Кто видит моё имя в моих диалогах"
        footer="Кто смотрит ваши диалоги и группы со стороны и кому имя не видно, видит вас в каждом диалоге под отдельным псевдонимом — без фото и перехода в профиль. Участники диалога видят вас по настройке выше. Текст сообщений остаётся публичным."
        value={settings.dialogueNameVisibility}
        onChange={onChange('dialogue_participant_name_masking')}
      />
      <SettingsSection
        title="Псевдоним"
        footer="Псевдоним выбирается случайно. Прежний перестаёт находиться в поиске сразу."
      >
        <View style={styles.alias}>
          <Text testID="privacy-alias" variant="body">
            Для тех, от кого скрыто имя, вы — {settings.identityAlias}
          </Text>
        </View>
        <SettingsRow
          testID="privacy-alias-regenerate"
          divided
          title="Другой псевдоним"
          accessory={
            regenerate.isPending ? (
              <ActivityIndicator color={theme.primary} accessibilityLabel="Подбираем псевдоним" />
            ) : null
          }
          onPress={() => {
            if (!regenerate.isPending) regenerate.mutate();
          }}
        />
      </SettingsSection>
      {regenerate.error ? (
        <Text variant="small" color="danger" style={styles.message}>
          {limitReached
            ? 'Псевдоним можно сменить не больше 5 раз в сутки. Попробуйте завтра.'
            : 'Не удалось сменить псевдоним. Проверьте интернет и попробуйте ещё раз.'}
        </Text>
      ) : null}
    </View>
  );
}
