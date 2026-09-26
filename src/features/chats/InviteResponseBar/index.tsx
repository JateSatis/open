import { View } from 'react-native';

import { styles } from './styles';

import type { MyInvite } from '@/api/invites';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type InviteResponseBarProps = {
  invite: MyInvite;
  /** Какой ответ уходит прямо сейчас. */
  responding: 'accept' | 'decline' | null;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
};

/**
 * Стоит на месте поля ввода, пока меня позвали, но я ещё не участник. Писать
 * до принятия нельзя — это решает база, а панель лишь говорит, как это
 * изменить.
 */
export function InviteResponseBar({
  invite,
  responding,
  error,
  onAccept,
  onDecline,
}: InviteResponseBarProps) {
  const theme = useTheme();
  const inviterName = invite.inviter?.displayName ?? 'Удалённый аккаунт';

  return (
    <View style={[styles.container, { borderTopColor: theme.border }]}>
      <Text variant="small" color="textSecondary">
        {invite.status === 'declined'
          ? 'Вы отклонили заявку. Её всё ещё можно принять.'
          : `${inviterName} зовёт вас в этот чат. Примите заявку, чтобы писать.`}
      </Text>

      {error ? (
        <Text variant="small" color="danger">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {invite.status === 'pending' ? (
          <Button
            label="Отклонить"
            variant="secondary"
            loading={responding === 'decline'}
            disabled={responding !== null}
            onPress={onDecline}
            style={styles.action}
          />
        ) : null}
        <Button
          label="Принять"
          loading={responding === 'accept'}
          disabled={responding !== null}
          onPress={onAccept}
          style={styles.action}
        />
      </View>
    </View>
  );
}
