import { useState } from 'react';

import { describeContactRefusal } from '@/api/contactErrors';
import { Button } from '@/components/Button';
import { OptionsSheet } from '@/components/OptionsSheet';
import { Text } from '@/components/Text';
import { confirmBlock } from '@/features/moderation/confirmBlock';
import { useIsBlocked, useSetBlocked } from '@/features/moderation/queries';
import { ReportSheet, type ReportTarget } from '@/features/moderation/ReportSheet';

/**
 * «Ещё» в чужом профиле: заблокировать (или разблокировать) и пожаловаться.
 * Заблокированному о блокировке ничего не сообщается — это решает сервер.
 */
export function PersonSafetyActions({ userId, name }: { userId: string; name: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const { data: blocked } = useIsBlocked(userId);
  const setBlocked = useSetBlocked();

  const block = async () => {
    if (await confirmBlock(name)) setBlocked.mutate({ userId, blocked: true });
  };

  const problem = setBlocked.error
    ? (describeContactRefusal(setBlocked.error) ??
      'Не получилось. Проверьте интернет и попробуйте ещё раз.')
    : null;

  return (
    <>
      <Button
        testID="person-safety-button"
        label={blocked ? 'Заблокирован(а) · Ещё' : 'Ещё'}
        variant="secondary"
        loading={setBlocked.isPending}
        onPress={() => setMenuOpen(true)}
      />
      {problem ? (
        <Text variant="small" color="danger">
          {problem}
        </Text>
      ) : null}
      <OptionsSheet
        visible={menuOpen}
        title={name}
        options={[
          blocked
            ? {
                label: 'Разблокировать',
                onPress: () => setBlocked.mutate({ userId, blocked: false }),
              }
            : { label: 'Заблокировать', destructive: true, onPress: () => void block() },
          {
            label: 'Пожаловаться',
            destructive: true,
            onPress: () => setReport({ userId, name }),
          },
        ]}
        onClose={() => setMenuOpen(false)}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </>
  );
}
