import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import type { ReportReason } from '@/api/blocks';
import { describeContactRefusal } from '@/api/contactErrors';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { SettingsRow } from '@/components/SettingsRow';
import { Text } from '@/components/Text';
import { useIsBlocked, useReportUser } from '@/features/moderation/queries';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Жалоба — пара фраз для модератора, не письмо. */
export const REPORT_COMMENT_MAX_LENGTH = 1000;

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'spam', label: 'Спам' },
  { id: 'harassment', label: 'Домогательства' },
  { id: 'threats', label: 'Угрозы' },
  { id: 'other', label: 'Другое' },
];

export type ReportTarget = {
  userId: string;
  name: string;
  /** Заявка на диалог, на которую жалуются; без неё — жалоба на профиль. */
  chatId?: string | null;
};

export type ReportSheetProps = {
  target: ReportTarget | null;
  onClose: () => void;
};

/**
 * Жалоба: причина, необязательный комментарий и предложение заодно
 * заблокировать. Отправленная — «Жалоба отправлена»; что с ней будет дальше,
 * знает только модерация.
 */
export function ReportSheet({ target, onClose }: ReportSheetProps) {
  if (!target) return null;

  // Новый человек — новая форма: ключ сбрасывает выбор, текст и отправку.
  return (
    <ReportForm key={`${target.userId}:${target.chatId ?? ''}`} target={target} onClose={onClose} />
  );
}

function ReportForm({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const report = useReportUser();
  const { data: alreadyBlocked } = useIsBlocked(target.userId);

  const send = () => {
    if (!reason || report.isPending) return;

    report.mutate({
      userId: target.userId,
      reason,
      chatId: target.chatId ?? null,
      comment,
      block: alsoBlock && !alreadyBlocked,
    });
  };

  const problem = report.error
    ? (describeContactRefusal(report.error) ??
      'Не удалось отправить жалобу. Проверьте интернет и попробуйте ещё раз.')
    : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: 'padding', default: undefined })}
      >
        <Pressable
          testID="report-sheet-backdrop"
          style={[styles.backdrop, { backgroundColor: theme.overlay }]}
          onPress={onClose}
        >
          <Pressable
            onPress={() => {}}
            style={[
              styles.sheet,
              {
                backgroundColor: theme.background,
                paddingBottom: Math.max(insets.bottom, Spacing.three),
              },
            ]}
          >
            {report.isSuccess ? (
              <View testID="report-sent" style={styles.content}>
                <Text variant="subtitle">Жалоба отправлена</Text>
                <Text color="textSecondary">
                  {alsoBlock && !alreadyBlocked
                    ? `Спасибо. ${target.name} заблокирован(а).`
                    : 'Спасибо, модерация её посмотрит.'}
                </Text>
                <Button label="Готово" onPress={onClose} />
              </View>
            ) : (
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

                <View style={[styles.group, { borderColor: theme.border }]}>
                  {REASONS.map((item, index) => (
                    <SettingsRow
                      key={item.id}
                      testID={`report-reason-${item.id}`}
                      title={item.label}
                      divided={index > 0}
                      accessory={reason === item.id ? <Text color="primary">✓</Text> : null}
                      onPress={() => setReason(item.id)}
                    />
                  ))}
                </View>

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
                  label={
                    alsoBlock && !alreadyBlocked ? 'Пожаловаться и заблокировать' : 'Пожаловаться'
                  }
                  variant="danger"
                  disabled={!reason}
                  loading={report.isPending}
                  onPress={send}
                />
                <Button label="Отмена" variant="secondary" onPress={onClose} />
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
