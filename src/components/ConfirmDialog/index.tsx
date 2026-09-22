import { Modal, Pressable, View } from 'react-native';

import { styles } from './styles';
import { resolveConfirmDialog, useConfirmDialogRequest } from './store';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export { confirm, type ConfirmDialogOptions } from './store';

/**
 * Единственный экземпляр на всё приложение — монтируется один раз в корневом
 * лэйауте. Любая фича просит подтверждение через `confirm()`, не заводя
 * собственный `Modal`: так по всему приложению одна и та же верстка «отмена
 * действия», а не N чуть разных.
 */
export function ConfirmDialogHost() {
  const theme = useTheme();
  const request = useConfirmDialogRequest();

  if (!request) return null;

  const { id, title, message, confirmLabel, cancelLabel, destructive } = request;

  const respond = (confirmed: boolean) => resolveConfirmDialog(id, confirmed);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => respond(false)}>
      <Pressable
        testID="confirm-dialog-backdrop"
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
        onPress={() => respond(false)}
      >
        {/* Отдельный Pressable без обработчика перехватывает нажатие на карточку
            раньше, чем оно дойдёт до фона позади — тап по самому диалогу не
            должен закрывать его как тап мимо. */}
        <Pressable onPress={() => {}}>
          <View style={[styles.card, { backgroundColor: theme.background }]}>
            <Text variant="subtitle" style={styles.title}>
              {title}
            </Text>

            {message ? (
              <Text color="textSecondary" style={styles.message}>
                {message}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Button
                label={cancelLabel}
                variant="secondary"
                style={styles.action}
                onPress={() => respond(false)}
              />
              <Button
                label={confirmLabel}
                variant={destructive ? 'danger' : 'primary'}
                style={styles.action}
                onPress={() => respond(true)}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
