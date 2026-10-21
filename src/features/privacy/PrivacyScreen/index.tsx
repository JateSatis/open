import { ActivityIndicator } from 'react-native';

import { styles } from './styles';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useMyPrivacySettings, useSetPrivacySetting } from '@/features/privacy/queries';
import { VisibilityChoice } from '@/features/privacy/VisibilityChoice';
import { describeLoadError } from '@/lib/network';

/**
 * «Конфиденциальность и безопасность». Здесь только настройки, которые уже
 * работают на сервере; остальные хранятся с верными значениями и появятся
 * группами «Идентичность», «Активность», «Контент и данные», «Поиск и
 * контакты» по мере того, как сервер начнёт их применять.
 */
export function PrivacyScreen() {
  const { data, isPending, error } = useMyPrivacySettings();
  const change = useSetPrivacySetting();
  const loadError = describeLoadError(error, 'Не удалось загрузить настройки');

  return (
    <Screen scrollable edges={['bottom']} contentContainerStyle={styles.content}>
      {isPending ? <ActivityIndicator accessibilityLabel="Загрузка настроек" /> : null}
      {loadError ? (
        <Text variant="small" color="danger" style={styles.message}>
          {loadError}
        </Text>
      ) : null}

      {data ? (
        <VisibilityChoice
          testID="privacy-friends-list"
          title="Кто видит список друзей"
          footer="Скрывает строку «Друзья» и список в вашем профиле от тех, кому он не виден. Вы свой список видите всегда."
          value={data.friendsListVisibility}
          onChange={(value) => change.mutate({ setting: 'friends_list_visibility', value })}
        />
      ) : null}

      {change.error ? (
        <Text variant="small" color="danger" style={styles.message}>
          Не удалось сохранить настройку. Проверьте интернет и попробуйте ещё раз.
        </Text>
      ) : null}
    </Screen>
  );
}
