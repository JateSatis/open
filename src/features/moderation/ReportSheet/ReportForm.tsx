import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { ReasonList } from './ReasonList';
import { styles } from './styles';
import type { ReportTarget } from './types';

import type { ReportReason } from '@/api/blocks';
import { describeContactRefusal } from '@/api/contactErrors';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { useIsBlocked, useReportUser } from '@/features/moderation/queries';

/** Жалоба — пара фраз для модератора, не письмо. */
export const REPORT_COMMENT_MAX_LENGTH = 1000;

/** Причина, комментарий, «заодно заблокировать» — и итог отправки. */
export function ReportForm({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const report = useReportUser();
  const { data: alreadyBlocked } = useIsBlocked(target.userId);
  const willBlock = alsoBlock && !alreadyBlocked;

  if (report.isSuccess) {
    // Итог — по тому, что ушло на сервер: статус блокировки после отправки
    // перечитывается и сказал бы, что человек «уже был заблокирован».
    return (
      <View testID="report-sent" style={styles.content}>
        <Text variant="subtitle">Жалоба отправлена</Text>
        <Text color="textSecondary">
          {report.variables?.block
            ? `Спасибо. ${target.name} заблокирован(а).`
            : 'Спасибо, модерация её посмотрит.'}
        </Text>
        <Button label="Готово" onPress={onClose} />
      </View>
    );
  }

  const send = () => {
    if (!reason || report.isPending) return;

    report.mutate({
      userId: target.userId,
      reason,
      chatId: target.chatId ?? null,
      comment,
      block: willBlock,
    });
  };

  const problem = report.error
    ? (describeContactRefusal(report.error) ??
      'Не удалось отправить жалобу. Проверьте интернет и попробуйте ещё раз.')
    : null;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <Text variant="subtitle">{`Пожаловаться: ${target.name}`}</Text>
      <Text variant="small" color="textSecondary">
        Что случилось?
      </Text>

      <ReasonList value={reason} onChange={setReason} />

      <Input
        accessibilityLabel="Комментарий к жалобе"
        placeholder="Комментарий — необязательно"
        value={comment}
        onChangeText={setComment}
        maxLength={REPORT_COMMENT_MAX_LENGTH}
        multiline
      />

      {alreadyBlocked ? null : (
        <View style={styles.blockRow}>
          <Text style={styles.flex}>Заодно заблокировать</Text>
          <Switch
            testID="report-also-block"
            accessibilityLabel="Заодно заблокировать"
            value={alsoBlock}
            onValueChange={setAlsoBlock}
          />
        </View>
      )}

      {problem ? (
        <Text variant="small" color="danger">
          {problem}
        </Text>
      ) : null}

      <Button
        testID="report-send"
        label={willBlock ? 'Пожаловаться и заблокировать' : 'Пожаловаться'}
        variant="danger"
        disabled={!reason}
        loading={report.isPending}
        onPress={send}
      />
      <Button label="Отмена" variant="secondary" onPress={onClose} />
    </ScrollView>
  );
}
