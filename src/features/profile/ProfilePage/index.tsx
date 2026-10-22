import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Profile } from '@/api/profile';
import { InfoCard, InfoPage, InfoTextRow, type SlideBack } from '@/components/InfoPage';
import { MediaViewer } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { displayNameOf, formatUsername } from '@/features/profile/username';
import { useAvatarSource } from '@/hooks/use-avatar-source';
import { Spacing } from '@/theme';

const NO_TABS: never[] = [];

export type ProfilePageProps = {
  profile: Profile;
  /** Над карточкой: «Имя пользователя не задано» в своём профиле. */
  lead?: ReactNode;
  /** Кнопки под карточкой — у своего профиля и у чужого разные. */
  actions?: ReactNode;
  /** Карточки между карточкой профиля и кнопками: «Друзья». */
  extraCards?: ReactNode;
  /** Справа сверху на фото: шестерёнка своего профиля. */
  barRight?: ReactNode;
  /** «Назад» на фото — у чужого профиля: страница въезжает и уезжает за пальцем. */
  slideBack?: SlideBack;
  /** Снизу под кнопками: место под панелью вкладок. */
  bottomInset?: number;
};

/**
 * Профиль человека — тот же верх, что у страниц информации: фото во всю
 * ширину (нет фото — блок с буквой), имя и статус внизу слева на нём; при
 * прокрутке фото уезжает, сверху остаётся плашка с именем. Ниже — о себе,
 * @имя и кнопки. Тап по фото — просмотр.
 */
export function ProfilePage({
  profile,
  lead,
  actions,
  extraCards,
  barRight,
  slideBack,
  bottomInset = 0,
}: ProfilePageProps) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const name = displayNameOf(profile);
  const username = formatUsername(profile.username);
  const onCopied = useCallback(() => showNotice('Скопировано'), []);
  const photoUri = profile.avatarUrl;
  // Фото человека — по подписанной ссылке: просмотр открывается, когда она есть.
  const photo = useAvatarSource(photoUri);

  return (
    <>
      <InfoPage
        testID="profile-page"
        slideBack={slideBack}
        title={name}
        status={profile.status ? { text: profile.status } : null}
        avatar={{ kind: 'single', uri: photoUri, name }}
        barRight={barRight}
        tabs={NO_TABS}
        onOpenPhoto={photo ? () => setPhotoOpen(true) : undefined}
        cards={
          <View style={{ paddingBottom: bottomInset + Spacing.three }}>
            {lead ? <View style={styles.lead}>{lead}</View> : null}
            <InfoCard testID="profile-card">
              {profile.bio ? (
                <InfoTextRow
                  testID="profile-bio"
                  value={profile.bio}
                  caption="О себе"
                  onCopied={onCopied}
                />
              ) : null}
              {username ? (
                <InfoTextRow
                  testID="profile-username"
                  value={username}
                  caption="Имя пользователя"
                  onCopied={onCopied}
                />
              ) : null}
            </InfoCard>
            {extraCards}
            {actions ? <View style={styles.actions}>{actions}</View> : null}
          </View>
        }
      />
      {photo ? (
        <MediaViewer
          visible={photoOpen}
          items={[{ id: 'avatar', kind: 'photo', url: photo.uri }]}
          initialIndex={0}
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  lead: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  actions: {
    marginHorizontal: Spacing.three,
    gap: Spacing.two,
  },
});
