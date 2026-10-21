import { KeyboardAvoidingView, Modal, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportForm } from './ReportForm';
import { styles } from './styles';
import type { ReportTarget } from './types';

import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type { ReportTarget } from './types';

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
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!target) return null;

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
          {/* Пустой обработчик: тап по листу не закрывает его как тап мимо. */}
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
            {/* Новый человек — новая форма: ключ сбрасывает выбор, текст и отправку. */}
            <ReportForm
              key={`${target.userId}:${target.chatId ?? ''}`}
              target={target}
              onClose={onClose}
            />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
