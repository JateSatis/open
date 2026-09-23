import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { styles } from './styles';
import {
  allocateConfirmDialogHostId,
  registerConfirmDialogHost,
  releaseConfirmDialogHost,
  resolveConfirmDialog,
  useConfirmDialogRequest,
  useIsTopConfirmDialogHost,
} from './store';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export { confirm, type ConfirmDialogOptions } from './store';

/**
 * Сам вопрос: затемнение и карточка с двумя кнопками. Своего окна не заводит —
 * рисуется там, где его поставили. Вёрстка на всё приложение одна, меняется
 * только окно, в котором она оказывается (см. `ConfirmDialogHost` и
 * `ConfirmDialogSurface`).
 */
function ConfirmDialogCard() {
  const theme = useTheme();
  const request = useConfirmDialogRequest();

  if (!request) return null;

  const { id, title, message, confirmLabel, cancelLabel, destructive } = request;

  const respond = (confirmed: boolean) => resolveConfirmDialog(id, confirmed);

  return (
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
  );
}

/**
 * Единственный экземпляр на всё приложение — монтируется один раз в корневом
 * лэйауте. Любая фича просит подтверждение через `confirm()`, не заводя
 * собственный `Modal`: так по всему приложению одна и та же верстка «отмена
 * действия», а не N чуть разных.
 *
 * Молчит, пока вопрос взялся рисовать кто-то ближе к человеку — экран со
 * своим окном (`ConfirmDialogSurface`).
 */
export function ConfirmDialogHost() {
  const request = useConfirmDialogRequest();
  const isTop = useIsTopConfirmDialogHost('root');

  if (!request || !isTop) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => resolveConfirmDialog(request.id, false)}>
      <ConfirmDialogCard />
    </Modal>
  );
}

/**
 * Тот же вопрос, но нарисованный прямо здесь, без своего `Modal`.
 *
 * Нужен экранам, которые сами живут в отдельном нативном окне: шит выбора
 * медиа завёрнут в `Modal` намеренно (нативный таб-бар и заголовок стека
 * иначе не перекрыть), и вопрос поверх него из корневого хоста означал бы
 * рождение второго нативного окна. Замер показал цену: около 200 мс
 * пропущенных кадров, и приходятся они ровно на то время, когда шит должен
 * реагировать на палец. Внутри уже открытого окна вопрос появляется за
 * считанные кадры.
 */
export function ConfirmDialogSurface() {
  // Номер берётся в рендере, а регистрация — в эффекте: она меняет общий
  // стор, и делать это во время рендера значит менять чужой компонент по
  // ходу его отрисовки. Перерисоваться после регистрации компонент не
  // забудет — он подписан на тот же стор. Успеть к первому вопросу эффект
  // успевает с запасом: шит монтируется задолго до того, как человек
  // потянет его закрывать.
  const [hostId] = useState(allocateConfirmDialogHostId);
  const isTop = useIsTopConfirmDialogHost(hostId);

  useEffect(() => {
    registerConfirmDialogHost(hostId);

    return () => releaseConfirmDialogHost(hostId);
  }, [hostId]);

  if (!isTop) return null;

  return <ConfirmDialogCard />;
}
