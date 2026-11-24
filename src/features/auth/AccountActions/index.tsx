import { useState } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { requestSelection } from '@/api/screenRequest';
import { confirm } from '@/components/ConfirmDialog';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { useDeleteAccount } from '@/features/auth/accountQueries';
import { signOut, signOutSavedAccount } from '@/features/auth/signOut';
import { confirmedSessionOwner, isCurrentSession } from '@/features/auth/sessionOwner';
import { useSessionStore } from '@/features/auth/sessionState';

export const DELETE_ACCOUNT_MESSAGE =
  'Профиль, имя, статус и аватар исчезнут, войти в этот аккаунт будет нельзя. ' +
  'Ваши сообщения останутся в чатах за подписью «Удалённый аккаунт»: переписка в Open ' +
  'публична, и она принадлежит всем её участникам. Отменить удаление нельзя.';

/** Выход и удаление аккаунта — низ экрана «Аккаунт». */
export function AccountActions() {
  const [signingOut, setSigningOut] = useState(false);
  const deletion = useDeleteAccount();
  const owner = useSessionStore(useShallow(confirmedSessionOwner));
  const slot = useSessionStore(state => state.accounts.find(account => account.userId === state.localAccountId));
  const selection = requestSelection();
  const [signOutError, setSignOutError] = useState(false);

  const onSignOut = async () => {
    const agreed = await confirm({
      title: 'Выйти из аккаунта?',
      message: 'Вы выйдете только на этом устройстве. На остальных вход сохранится.',
      confirmLabel: 'Выйти',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (!agreed || selection !== requestSelection()) return;

    setSigningOut(true);
    setSignOutError(false);
    try {
      if (owner && isCurrentSession(owner)) await signOut(owner);
      else if (!owner && slot) await signOutSavedAccount(slot, selection, slot.sessionId ? { userId: slot.userId, sessionId: slot.sessionId } : undefined);
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  };

  const onDelete = async () => {
    const agreed = await confirm({
      title: 'Удалить аккаунт?',
      message: DELETE_ACCOUNT_MESSAGE,
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (agreed && owner && isCurrentSession(owner)) deletion.mutate(owner);
  };

  return (
    <View style={styles.container}>
      <Button
        label="Выйти из аккаунта"
        variant="secondary"
        loading={signingOut}
        disabled={(!owner && !slot) || deletion.isPending}
        onPress={() => void onSignOut()}
      />
      {signOutError && <Text variant="small" color="danger">Не удалось выйти. Попробуйте ещё раз.</Text>}

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
