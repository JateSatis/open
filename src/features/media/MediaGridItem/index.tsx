import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatDuration } from '@/features/media/lib/formatDuration';
import {
  openMediaPreview,
  registerGridCell,
  unregisterGridCell,
} from '@/features/media/MediaPreview/previewStore';
import { assetPreviewUri } from '@/features/media/lib/previewUri';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { useEditedThumb } from '@/features/media/photoEdits/editedThumbs';
import { countMount, countRender, perfLog } from '@/features/media/perf';
import { SLOT_BLOCKED, SLOT_FREE, useSelectionSlot } from '@/features/media/selectionStore';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Spacing } from '@/theme';

/**
 * Выбор одного файла вместо отбора в альбом: кружка нет. Неподходящие файлы
 * видны, но притушены и не нажимаются. Общий выбор (`selectionStore`) в этом
 * режиме не трогается.
 */
export type GridPick = {
  accepts: (asset: MediaLibraryItem) => boolean;
  /**
   * Тап сразу отдаёт файл. Нет — тап раскрывает файл в предпросмотр, и
   * решение принимается там (шит аватарки: сначала правка, потом «Готово»).
   */
  onPick?: (asset: MediaLibraryItem) => void;
};

export type MediaGridItemProps = {
  asset: MediaLibraryItem;
  size: number;
  onToggle: (asset: MediaLibraryItem) => void;
  /** Есть — клетка выбирает один файл, а не отмечает его кружком. */
  pick?: GridPick;
  /** Галерею сейчас взять нельзя (к посту уже прикреплён поп): клетка притушена. */
  locked?: boolean;
};

/**
 * Нажатие на саму клетку раскрывает файл в предпросмотр (`MediaPreview`) —
 * из этой самой плитки; выбор и снятие выбора — только кружок в углу.
 * Предпросмотр открывается через стор и узнаёт место плитки из таблицы
 * клеток: ни пропов, ни подписок клетке это не добавляет.
 *
 * Клетка подписана на своё состояние в выборе одним числом, а не получает
 * его пропом: так тап по кружку перерисовывает ровно одну клетку, а не всё
 * видимое окно списка. Пропы при этом остаются стабильными, и `memo`
 * работает — его ломала новая стрелка `onToggle` на каждый рендер грида.
 *
 * Подписка ровно одна: в окне списка клеток десятки, и каждая лишняя
 * подписка — это лишний слушатель стора и лишний пересчёт на каждый тап.
 */
export const MediaGridItem = memo(function MediaGridItem({
  asset,
  size,
  onToggle,
  pick,
  locked = false,
}: MediaGridItemProps) {
  countRender('MediaGridItem');

  const theme = useTheme();
  const slot = useSelectionSlot(asset.id);
  // Отредактированное фото — картинкой правки. Подписка по id, а не на
  // стор: тапы по кружкам её не задевают (см. `editedThumbs`).
  const editedThumb = useEditedThumb(asset.id);
  // Помним, у какого файла превью не открылось, а не просто «не открылось»:
  // список переиспользует клетку под другие файлы, и флаг без id делал бы
  // битыми и их.
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === asset.id;

  useEffect(() => countMount('MediaGridItem'), []);

  // Клетку переиспользуют под другие файлы — запись в таблице меняется вместе с файлом.
  const rootRef = useRef<View>(null);

  useEffect(() => {
    const view = rootRef.current;

    registerGridCell(asset.id, view);

    return () => unregisterGridCell(asset.id, view);
  }, [asset.id]);

  const isSelected = slot > SLOT_FREE;
  const disabled = locked || slot === SLOT_BLOCKED;
  // В выборе одного файла — над притушиванием: длительность читается и у
  // видео, которое взять нельзя. В шите чата — под притушиванием лимита, как
  // вся клетка. Касания пропускает к клетке.
  const durationBadge =
    asset.kind === 'video' ? (
      <View pointerEvents="none" style={[styles.videoBadge, { backgroundColor: theme.mediaScrim }]}>
        <Text variant="caption" color="textInverse">
          {asset.durationMs !== null ? formatDuration(asset.durationMs) : '▶'}
        </Text>
      </View>
    ) : null;
  const openPreview = () =>
    rootRef.current?.measureInWindow((x, y, width, height) =>
      openMediaPreview(asset, width > 0 ? { x, y, width, height } : null),
    );

  return (
    <View ref={rootRef} style={{ width: size, height: size }}>
      {failed ? (
        // Файл объективно не открывается (битый, не скачан из облака,
        // незнакомый кодек). Это не «ещё грузится», и выглядеть должно иначе.
        <View
          style={[styles.thumbnail, styles.broken, { backgroundColor: theme.backgroundElement }]}
        >
          <Text variant="caption" color="textSecondary">
            ?
          </Text>
        </View>
      ) : (
        <Image
          testID="media-grid-preview"
          // Источник — сам id ассета: content:// на Android, ph:// на iOS.
          // Оба expo-image открывает напрямую, у видео берёт кадр.
          source={{ uri: editedThumb ?? assetPreviewUri(asset) }}
          style={[styles.thumbnail, { backgroundColor: theme.backgroundElement }]}
          contentFit="cover"
          // Только память: у Glide она ограничена, и превью, пролистанные
          // туда и обратно, берутся из неё. Диск для локальных content://
          // бесполезен — исходник и так лежит на устройстве.
          cachePolicy="memory"
          recyclingKey={editedThumb ?? asset.id}
          // Правка подменяет картинку без перехода: фото только что
          // прилетело в плитку той же картинкой.
          transition={editedThumb ? 0 : 120}
          onError={(event) => {
            perfLog('превью не открылось', { id: asset.id, error: String(event.error) });
            setFailedId(asset.id);
          }}
          accessibilityIgnoresInvertColors
        />
      )}

      {pick ? null : durationBadge}

      {locked && !isSelected ? (
        <View
          testID="media-grid-locked"
          pointerEvents="none"
          style={[
            styles.thumbnail,
            { backgroundColor: theme.background, opacity: Opacity.unavailable },
          ]}
        />
      ) : null}

      {pick ? <PickCover asset={asset} pick={pick} onOpen={openPreview} /> : null}

      {pick ? durationBadge : null}

      {pick ? null : (
        <>
          {locked ? null : (
            <Pressable
              testID="media-grid-open"
              accessibilityRole="imagebutton"
              accessibilityLabel={asset.kind === 'video' ? 'Открыть видео' : 'Открыть фото'}
              onPress={openPreview}
              style={styles.thumbnail}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSelected ? 'Убрать из выбранного' : 'Выбрать файл'}
            accessibilityState={{ selected: isSelected, disabled }}
            disabled={disabled}
            hitSlop={Spacing.two}
            onPress={() => onToggle(asset)}
            style={[
              styles.circle,
              {
                borderColor: theme.textInverse,
                backgroundColor: isSelected ? theme.primary : theme.mediaScrim,
                opacity: disabled ? 0.4 : 1,
              },
            ]}
          >
            {isSelected ? (
              <Text variant="caption" color="primaryText">
                {slot}
              </Text>
            ) : null}
          </Pressable>
        </>
      )}
    </View>
  );
});

type PickCoverProps = {
  asset: MediaLibraryItem;
  pick: GridPick;
  /** Раскрыть файл в предпросмотр из этой плитки. */
  onOpen: () => void;
};

/** Вся клетка — кнопка выбора; неподходящий файл притушен и не нажимается. */
function PickCover({ asset, pick, onOpen }: PickCoverProps) {
  const theme = useTheme();
  const accepted = pick.accepts(asset);

  return (
    <Pressable
      testID="media-grid-pick"
      accessibilityRole="button"
      accessibilityLabel={asset.kind === 'video' ? 'Видео' : 'Фото'}
      accessibilityState={{ disabled: !accepted }}
      disabled={!accepted}
      onPress={() => (pick.onPick ? pick.onPick(asset) : onOpen())}
      style={[
        styles.thumbnail,
        !accepted && { backgroundColor: theme.background, opacity: Opacity.unavailable },
      ]}
    />
  );
}
