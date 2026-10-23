import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import type { VisibilitySetting, Visibility } from '@/api/privacy';
import { Screen } from '@/components/Screen';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { Text } from '@/components/Text';
import { DelayChoice } from '@/features/privacy/DelayChoice';
import { IdentitySection } from '@/features/privacy/IdentitySection';
import { useMyPrivacySettings, useSetPrivacySetting } from '@/features/privacy/queries';
import { VisibilityChoice } from '@/features/privacy/VisibilityChoice';
import { useTheme } from '@/hooks/use-theme';
import { describeLoadError } from '@/lib/network';
import { Sizes } from '@/theme';

/**
 * «Конфиденциальность и безопасность». Здесь только настройки, которые уже
 * работают на сервере; остальные хранятся с верными значениями и появятся
 * в группе «Контент и данные» по мере того, как сервер начнёт их применять. Пояснения говорят, что именно скрыто и от кого, — и
 * не обещают анонимности: переписка в Open публична.
 */
export function PrivacyScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { data, isPending, error } = useMyPrivacySettings();
  const change = useSetPrivacySetting();
  const loadError = describeLoadError(error, 'Не удалось загрузить настройки');
  const set = (setting: VisibilitySetting) => (value: Visibility) =>
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
          <IdentitySection settings={data} onChange={set} />

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
            <DelayChoice
              value={data.publicDelay}
              onChange={(value) =>
                change.mutate({ setting: 'public_message_visibility_delay', value })
              }
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
              testID="privacy-avatar"
              title="Кто видит мою фотографию"
              footer="Остальные видят вместо фото букву имени — в профиле, чатах, комментариях и звонках. Фото, которое кто-то уже сохранил, так не отозвать."
              value={data.avatarVisibility}
              onChange={set('avatar_visibility')}
            />
            <VisibilityChoice
              testID="privacy-friends-list"
              title="Кто видит список друзей"
              footer="Скрывает строку «Друзья» и список в вашем профиле от тех, кому он не виден. Вы свой список видите всегда."
              value={data.friendsListVisibility}
              onChange={set('friends_list_visibility')}
            />
            <SettingsSection
              title="Заявки и блокировки"
              footer="Люди, которые вам не друзья, могут прислать заявку — одно сообщение без медиа. Переписка начнётся, когда вы её примете."
            >
              <SettingsRow
                testID="privacy-blocked"
                title="Заблокированные"
                accessory={
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={Sizes.menuIcon}
                    tintColor={theme.textSecondary}
                  />
                }
                onPress={() => router.push('/profile/blocked')}
              />
            </SettingsSection>
          </View>

          <View style={styles.group}>
            <Text variant="bodyBold" style={styles.groupTitle}>
              Контент и данные
            </Text>
            <VisibilityChoice
              testID="privacy-media"
              title="Кто видит мои фото, видео и голосовые"
              footer="Участники чата, куда вы отправили, видят всегда. Остальные — по этой настройке. Кто уже открыл файл, мог его сохранить."
              value={data.mediaVisibility}
              onChange={set('dialogue_media_visibility')}
            />
            {/* Правило для всех, а не настройка: переключателя нет. Про
                содержимое кадра ничего не обещает. */}
            <Text
              testID="privacy-metadata-note"
              variant="small"
              color="textSecondary"
              style={styles.message}
            >
              Из фото и видео перед отправкой удаляются геометка, модель телефона и дата съёмки.
            </Text>
            {/* Скрытый текст — правило для всех, не настройка: строка без
                переключателя. */}
            <Text
              testID="privacy-hidden-text-note"
              variant="small"
              color="textSecondary"
              style={styles.message}
            >
              Часть своего сообщения можно скрыть от зрителей: выделите текст → «Скрыть от
              зрителей». Участники видят всё.
            </Text>
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
