import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import type { EditablePrivacySetting, Visibility } from '@/api/privacy';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useMyPrivacySettings, useSetPrivacySetting } from '@/features/privacy/queries';
import { VisibilityChoice } from '@/features/privacy/VisibilityChoice';
import { describeLoadError } from '@/lib/network';

/**
 * «Конфиденциальность и безопасность». Здесь только настройки, которые уже
 * работают на сервере; остальные хранятся с верными значениями и появятся
 * в группах «Идентичность», «Контент и данные» по мере того, как сервер
 * начнёт их применять. Пояснения говорят, что именно скрыто и от кого, — и
 * не обещают анонимности: переписка в Open публична.
 */
export function PrivacyScreen() {
  const { data, isPending, error } = useMyPrivacySettings();
  const change = useSetPrivacySetting();
  const loadError = describeLoadError(error, 'Не удалось загрузить настройки');
  const set = (setting: EditablePrivacySetting) => (value: Visibility) =>
    change.mutate({ setting, value });

  return (
    <Screen scrollable edges={['bottom']} contentContainerStyle={styles.content}>
      {isPending ? <ActivityIndicator accessibilityLabel="Загрузка настроек" /> : null}
      {loadError ? (
        <Text variant="small" color="danger" style={styles.message}>
          {loadError}
        </Text>
      ) : null}

      {data ? (
        <>
          <View style={styles.group}>
            <Text variant="bodyBold" style={styles.groupTitle}>
              Активность
            </Text>
            <VisibilityChoice
              testID="privacy-activity-status"
              title="Кто видит, что я в сети"
              footer="Тем, кому не видно, не показываются «в сети», «был(а) в …», «печатает» и «записывает голосовое». Звонки остаются публичными."
              value={data.activityStatusVisibility}
              onChange={set('activity_status_visibility')}
            />
            <VisibilityChoice
              testID="privacy-message-time"
              title="Кто видит время сообщений и прочтение"
              footer="Время, даты и отметки прочтения скрываются во всех диалогах, где вы участвуете, — у всех их сообщений, не только ваших. Сам текст переписки остаётся публичным. Вы тоже не увидите прочтение у тех, от кого скрыли время."
              value={data.messageTimeVisibility}
              onChange={set('message_activity_metadata_visibility')}
            />
          </View>

          <View style={styles.group}>
            <Text variant="bodyBold" style={styles.groupTitle}>
              Поиск и контакты
            </Text>
            <VisibilityChoice
              testID="privacy-search"
              title="Кто может найти меня в поиске"
              footer="Тот, кому не видно, не найдёт вас ни по имени, ни по @username, а ваши сообщения — в поиске по чатам, где он не участник. Диалоги и профиль по-прежнему открываются по ссылке."
              value={data.searchVisibility}
              onChange={set('account_search_visibility')}
            />
            <VisibilityChoice
              testID="privacy-friends-list"
              title="Кто видит список друзей"
              footer="Скрывает строку «Друзья» и список в вашем профиле от тех, кому он не виден. Вы свой список видите всегда."
              value={data.friendsListVisibility}
              onChange={set('friends_list_visibility')}
            />
          </View>
        </>
      ) : null}

      {change.error ? (
        <Text variant="small" color="danger" style={styles.message}>
          Не удалось сохранить настройку. Проверьте интернет и попробуйте ещё раз.
        </Text>
      ) : null}
    </Screen>
  );
}
