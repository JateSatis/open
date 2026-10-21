import { useState } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import { FriendRequestLimitError, type FriendshipStatus } from '@/api/friends';
import { Button } from '@/components/Button';
import { confirm } from '@/components/ConfirmDialog';
import { OptionsSheet } from '@/components/OptionsSheet';
import { Text } from '@/components/Text';
import { useFriendAction, useFriendshipStatus, type FriendAction } from '@/features/friends/queries';

const LABELS: Record<Exclude<FriendshipStatus, 'self'>, string> = {
  none: 'Добавить в друзья',
  outgoing: 'Заявка отправлена',
  incoming: 'Принять заявку',
  friends: 'Вы друзья',
};

function describeError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof FriendRequestLimitError) return error.message;

  return 'Не получилось. Проверьте интернет и попробуйте ещё раз.';
}

/**
 * Кнопка дружбы в чужом профиле. Отклонённая им заявка выглядит для меня как
 * «Заявка отправлена» — это решает сервер, кнопка лишь показывает его ответ.
 */
export function FriendButton({ userId, name }: { userId: string; name: string }) {
  const { data: status, isPending, isError, refetch } = useFriendshipStatus(userId);
  const action = useFriendAction();
  const [menuOpen, setMenuOpen] = useState(false);

  if (status === 'self') return null;

  const run = (kind: FriendAction) => action.mutate({ action: kind, userId });

  const onPress = async () => {
    // Не знаем, кто мы друг другу, — сначала узнать, а не гадать.
    if (isError) {
      void refetch();
      return;
    }

    switch (status) {
      case 'none':
        run('send');
        return;
      case 'incoming':
        run('accept');
        return;
      case 'friends':
        setMenuOpen(true);
        return;
      case 'outgoing': {
        const agreed = await confirm({
          title: 'Отменить заявку?',
          message: `${name} больше не увидит её в заявках.`,
          confirmLabel: 'Отменить заявку',
          cancelLabel: 'Оставить',
          destructive: true,
        });

        if (agreed) run('cancel');
        return;
      }
    }
  };

  const problem =
    describeError(action.error) ??
    (isError ? 'Не удалось загрузить. Нажмите, чтобы попробовать ещё раз.' : null);

  return (
    <View style={styles.container}>
      <Button
        testID="friend-button"
        label={LABELS[status ?? 'none']}
        variant={status === 'incoming' ? 'primary' : 'secondary'}
        loading={isPending || action.isPending}
        onPress={() => void onPress()}
      />
      {problem ? (
        <Text variant="small" color="danger">
          {problem}
        </Text>
      ) : null}
      <OptionsSheet
        visible={menuOpen}
        title={`${name} у вас в друзьях`}
        options={[{ label: 'Удалить из друзей', destructive: true, onPress: () => run('remove') }]}
        onClose={() => setMenuOpen(false)}
      />
    </View>
  );
}
