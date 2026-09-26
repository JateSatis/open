import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import {
  closeMediaSheet,
  MediaPickerSheet,
  openMediaSheet,
} from '@/features/chats/MediaPickerSheet';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { queryRecentMedia, useMediaSelection, useSelectionCount } from '@/features/media';
import {
  MEDIA_PERF,
  countRender,
  perfLog,
  probeJsFrames,
  reportMounts,
  reportRenders,
  resetPerfCounters,
} from '@/features/media/perf';

/** Окно замера кадров: столько идёт сама анимация, остальное к ней не относится. */
const ANIMATION_MS = 700;
/** Закрытие короче открытия, и мерить его надо по его же длительности. */
const CLOSE_MS = 400;
/** Сколько ждём после открытия, прежде чем считать обстановку спокойной. */
const SETTLE_MS = 9000;

/**
 * Стенд для замеров шита выбора медиа: тот же шит и тот же черновик, но без
 * чата, сессии и сети. Нужен затем, что фризы измеряются по кадрам JS-потока
 * во время анимации, а на экране чата к этим кадрам примешивается загрузка
 * переписки. Открывается диплинком: openger://media-lab
 *
 * Сценарий проигрывается сам, без тапов: координаты кнопок плавают, а замер
 * должен быть повторяемым. Скролл при этом остаётся за человеком (или за
 * `adb shell input swipe`) — его как раз и меряем.
 */
export default function MediaLabScreen() {
  countRender('MediaLabScreen');

  const draft = useComposerDraft('media-lab');
  const selectedCount = useSelectionCount();

  useEffect(() => {
    if (!MEDIA_PERF) return;

    const timer = setInterval(() => {
      reportRenders('за 2 с');
      reportMounts('за 2 с');
    }, 2000);

    return () => clearInterval(timer);
  }, []);

  /** Открыть и оставить открытым: дальше скроллю руками и смотрю на счётчики. */
  const openOnly = useCallback(() => {
    resetPerfCounters();
    perfLog('=== открываю для скролла ===');
    probeJsFrames('открытие', ANIMATION_MS);
    openMediaSheet();
  }, []);

  /** Полный прогон: открытие, выбор в тишине, закрытие. */
  const run = useCallback(() => {
    void queryRecentMedia({ offset: 0, limit: 1 }).then(([first]) => {
      resetPerfCounters();
      perfLog('=== прогон: открываю ===');
      probeJsFrames('открытие', ANIMATION_MS);
      openMediaSheet();

      setTimeout(() => {
        if (!first) return;

        reportRenders('до тапа (в тишине)');
        reportMounts('до тапа (в тишине)');
        perfLog('=== прогон: тап по кружку ===');
        useMediaSelection.getState().toggle(first);

        setTimeout(() => {
          reportRenders('ОДИН ТАП');
          reportMounts('ОДИН ТАП');
        }, 500);
      }, SETTLE_MS);

      setTimeout(() => {
        perfLog('=== прогон: закрываю ===');
        probeJsFrames('закрытие', CLOSE_MS);
        closeMediaSheet();
      }, SETTLE_MS + 1500);
    });
  }, []);

  return (
    <View style={styles.root}>
      <Text variant="small">Стенд: шит выбора медиа</Text>
      <Text variant="small">выбрано: {selectedCount}</Text>

      <Button label="Прогон" onPress={run} />
      <Button label="Открыть для скролла" variant="secondary" onPress={openOnly} />

      <MediaPickerSheet
        draft={draft}
        onTyping={() => undefined}
        onSend={() => draft.clear()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
});
