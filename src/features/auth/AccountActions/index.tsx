import { useState } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { confirm } from '@/components/ConfirmDialog';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { useDeleteAccount } from '@/features/auth/accountQueries';
import { signOut } from '@/features/auth/signOut';
import { confirmedAccountId, useSessionStore } from '@/features/auth/sessionState';

export const DELETE_ACCOUNT_MESSAGE =
  'Профиль, имя, статус и аватар исчезнут, войти в этот аккаунт будет нельзя. ' +
  'Ваши сообщения останутся в чатах за подписью «Удалённый аккаунт»: переписка в Open ' +
  'публична, и она принадлежит всем её участникам. Отменить удаление нельзя.';

/** Выход и удаление аккаунта — низ экрана «Аккаунт». */
export function AccountActions() {
  const [signingOut, setSigningOut] = useState(false);
  const deletion = useDeleteAccount();
  const owner = useSessionStore(confirmedAccountId);

  const onSignOut = async () => {
    const agreed = await confirm({
      title: 'Выйти из аккаунта?',
      message: 'Вы выйдете только на этом устройстве. На остальных вход сохранится.',
      confirmLabel: 'Выйти',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (!agreed || !owner) return;

    setSigningOut(true);
    // Экран входа покажет навигация, как только пропадёт сессия; этот экран
    // к тому моменту уже размонтирован, поэтому состояние назад не сбрасываем.
    await signOut(owner);
  };

  const onDelete = async () => {
    const agreed = await confirm({
      title: 'Удалить аккаунт?',
      message: DELETE_ACCOUNT_MESSAGE,
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (agreed) deletion.mutate();
  };

  return (
    <View style={styles.container}>
      <Button
        label="Выйти из аккаунта"
        variant="secondary"
        loading={signingOut}
        disabled={!owner || deletion.isPending}
        onPress={() => void onSignOut()}
      />

      <View style={styles.delete}>
        <LinkButton
          label="Удалить аккаунт"
          color="textSecondary"
          loading={deletion.isPending}
          disabled={!owner || signingOut}
          onPress={() => void onDelete()}
        />
        {deletion.error ? (
          <Text variant="small" color="danger" style={styles.centered}>
            Не удалось удалить аккаунт. Проверьте интернет и попробуйте ещё раз.
          </Text>
        ) : null}
      </View>
    </View>
  );
}
