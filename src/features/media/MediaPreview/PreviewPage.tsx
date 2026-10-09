import type { SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { memo, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { NO_LAYERS, safeDrawingLayersOf, type DrawingLayers } from './drawingLayers';
import { EditedPhoto, type LiveAdjust } from './EditedPhoto';
import { fitRect, flightTransform } from './previewGeometry';
import type { Rect } from './previewStore';
import { PreviewVideo } from './PreviewVideo';
import { styles } from './styles';
import type { LiveDraw } from './useDrawTool';
import { workingCopyOf, workingImageOf } from './workingCopy';

import { assetPreviewUri } from '@/features/media/lib/previewUri';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { cropAspect, defaultCrop, type PhotoCrop } from '@/features/media/photoEdits/crop';
import { useEditedThumb } from '@/features/media/photoEdits/editedThumbs';
import { usePhotoEdit } from '@/features/media/photoEdits/editsStore';
import type { PhotoDrawing } from '@/features/media/photoEdits/drawing';
import type { PhotoEdit } from '@/features/media/photoEdits/types';

/** Общая анимация слоя — читают её только страницы, которым она нужна. */
export type PreviewMotion = {
  /** Перелёт из плитки: 0 — фото в плитке, 1 — на месте. */
  flight: SharedValue<number>;
  /** Плитка, из которой фото вылетело или в которую улетает. */
  origin: SharedValue<Rect | null>;
  /** Открыт инструмент: 0 — фото на весь экран, 1 — в рабочей области. */
  tool: Readonly<SharedValue<number>>;
  /** Рабочая область фото, пока открыт инструмент. */
  toolArea: SharedValue<Rect>;
  /** Предпросмотр гаснет на месте (плитки не видно или отправка): 1 — виден. */
  fade: SharedValue<number>;
  /** Открыта обрезка: фото рисует она, страница прячется. 1 — спрятана. */
  cropCover: SharedValue<number>;
};

export type PreviewPageProps = {
  asset: MediaLibraryItem;
  width: number;
  height: number;
  /** Сторона клетки сетки — превью той же стороны уже лежит в памяти. */
  cellSize: number;
  isActive: boolean;
  motion: PreviewMotion;
  /** Ползунки открытого инструмента — только у активной страницы. */
  live: LiveAdjust | null;
  /** Открытое рисование — только у активной страницы. */
  draw: LiveDraw | null;
  /** Превью активной страницы на экране — можно начинать перелёт. */
  onShown?: () => void;
  /**
   * Предпросмотр уходит. Видео на это время уступает место своему кадру:
   * поверхность видео пробивает окно насквозь, и сквозь гаснущий слой был
   * бы виден чат, а не шит.
   */
  leaving?: boolean;
};

/** Столько фото должно пробыть текущим, чтобы для него заранее готовилась рабочая копия. */
const PREPARE_AFTER_MS = 700;

function aspectOf(asset: MediaLibraryItem): number {
  return asset.width && asset.height ? asset.width / asset.height : 1;
}

/**
 * Страница предпросмотра: фото, вписанное в экран целиком, или видео.
 *
 * Первым кадром видно превью из сетки — `expo-image` держит его в памяти, и
 * та же сторона клетки с тем же источником берётся оттуда мгновенно. Над ним
 * догружается полное разрешение, над ним — правка на Skia, когда она есть.
 * Слои совпадают по краям, и смена одного на другой не мигает.
 *
 * У отредактированного фото первый кадр — картинка правки, та же, что в
 * плитке. Обрезанное вписывается по пропорциям обрезки, и оригинал под ним
 * не рисуется вовсе: его края выглянули бы из-под правки.
 */
export const PreviewPage = memo(function PreviewPage({
  asset,
  width,
  height,
  cellSize,
  isActive,
  motion,
  live,
  draw,
  onShown,
  leaving = false,
}: PreviewPageProps) {
  const [imageAspect, setAspect] = useState(() => aspectOf(asset));
  const [thumbShown, setThumbShown] = useState(false);
  const isPhoto = asset.kind === 'photo';
  const edit = usePhotoEdit(isPhoto ? asset.id : null);
  const crop = edit?.crop;
  const editedThumb = useEditedThumb(asset.id);
  const aspect = crop ? cropAspect(crop) : imageAspect;
  // Обрезанное без готовой картинки правки: до Skia показывать нечего,
  // оригинал не годится — лететь можно сразу.
  const blank = crop !== undefined && editedThumb === undefined;
  // Оригинал — пока у фото нет ни картинки правки, ни обрезки.
  const showOriginal = editedThumb === undefined && crop === undefined;
  const shown = thumbShown || blank;

  // Эффект, а не прямо из `onLoad`: перелёт должен стартовать уже с
  // пересчитанной по картинке рамкой.
  useEffect(() => {
    if (shown && isActive) onShown?.();
  }, [isActive, onShown, shown]);
  const base = useMemo(
    () => fitRect(aspect, { x: 0, y: 0, width, height }),
    [aspect, height, width],
  );
  const skia = useEditedImage(asset, edit, isPhoto && isActive, live !== null || draw !== null);
  const layers = useDrawingLayers(asset.id, skia?.image ?? null, edit?.drawing);

  const frameStyle = useAnimatedStyle(() => {
    const target = isActive ? toolTarget(aspect, base, motion) : base;
    const { frame } = flightTransform(
      base,
      target,
      isActive ? motion.origin.value : null,
      isActive ? motion.flight.value : 1,
    );

    return {
      opacity: isActive ? motion.fade.value * (1 - motion.cropCover.value) : 1,
      transform: [
        { translateX: frame.translateX },
        { translateY: frame.translateY },
        { scaleX: frame.scaleX },
        { scaleY: frame.scaleY },
      ],
    };
  });

  const imageStyle = useAnimatedStyle(() => {
    const target = isActive ? toolTarget(aspect, base, motion) : base;
    const { image } = flightTransform(
      base,
      target,
      isActive ? motion.origin.value : null,
      isActive ? motion.flight.value : 1,
    );

    return { transform: [{ scaleX: image.scaleX }, { scaleY: image.scaleY }] };
  });

  // Превью стороной в клетку сетки — той же, что в памяти, — растянутое до рамки.
  const thumbBox = {
    width: cellSize,
    height: cellSize,
    left: (base.width - cellSize) / 2,
    top: (base.height - cellSize) / 2,
    transform: [{ scale: Math.max(base.width, base.height) / cellSize }],
  };

  return (
    <View testID="media-preview-page" style={{ width, height }}>
      {/* Гаснущая рамка с обрезкой краёв без отдельного буфера на Android
          вырезала окно шита насквозь — сквозь неё был виден чат. */}
      <Animated.View
        needsOffscreenAlphaCompositing
        style={[
          styles.frame,
          { left: base.x, top: base.y, width: base.width, height: base.height },
          frameStyle,
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          {editedThumb !== undefined ? (
            <View style={[styles.thumb, thumbBox]}>
              <Image
                testID="media-preview-edited"
                source={{ uri: editedThumb }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="memory"
                recyclingKey={editedThumb}
                onLoad={(event) => {
                  const { width: loadedWidth, height: loadedHeight } = event.source;

                  // Без обрезки пропорции — по картинке правки: она повёрнута по
                  // EXIF, а медиатека отдаёт размеры без поворота.
                  if (crop === undefined && loadedWidth > 0 && loadedHeight > 0) {
                    setAspect(loadedWidth / loadedHeight);
                  }
                  setThumbShown(true);
                }}
                onError={() => setThumbShown(true)}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : null}

          {showOriginal ? (
            <View style={[styles.thumb, thumbBox]}>
              <Image
                source={{ uri: assetPreviewUri(asset) }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="memory"
                recyclingKey={asset.id}
                // Пропорции — по картинке: медиатека знает размеры не у всех
                // файлов и без EXIF-поворота. Перелёт стартует уже с ними.
                onLoad={(event) => {
                  const { width: loadedWidth, height: loadedHeight } = event.source;

                  if (loadedWidth > 0 && loadedHeight > 0) setAspect(loadedWidth / loadedHeight);
                  setThumbShown(true);
                }}
                onError={() => setThumbShown(true)}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : null}

          {isPhoto && !showOriginal ? null : isPhoto ? (
            <Image
              testID="media-preview-photo"
              source={{ uri: assetPreviewUri(asset) }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              cachePolicy="memory"
              transition={120}
              onLoad={(event) => {
                const { width: loadedWidth, height: loadedHeight } = event.source;

                // Медиатека отдаёт размеры без EXIF-поворота — верим картинке.
                if (loadedWidth > 0 && loadedHeight > 0) setAspect(loadedWidth / loadedHeight);
              }}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <PreviewVideo asset={asset} isActive={isActive} hidden={leaving} />
          )}

          {/* Уходящее видео закрыто своим кадром в тот же кадр, в который
              видео убирается: его поверхность ещё кадр держит дыру в окне. */}
          {leaving && !isPhoto ? (
            <View style={[styles.thumb, thumbBox]}>
              <Image
                source={{ uri: assetPreviewUri(asset) }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="memory"
                recyclingKey={asset.id}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : null}

          {skia ? (
            <EditedPhoto
              image={skia.image}
              width={base.width}
              height={base.height}
              adjust={live ?? skia.adjust}
              crop={crop ?? skia.plain}
              layers={layers}
              draw={draw}
            />
          ) : null}
        </Animated.View>
      </Animated.View>
    </View>
  );
});

/** Куда встаёт фото активной страницы: на весь экран или в рабочую область инструмента. */
function toolTarget(aspect: number, base: Rect, motion: PreviewMotion): Rect {
  'worklet';
  const progress = motion.tool.value;

  if (progress === 0) return base;

  const area = fitRect(aspect, motion.toolArea.value);

  return {
    x: base.x + (area.x - base.x) * progress,
    y: base.y + (area.y - base.y) * progress,
    width: base.width + (area.width - base.width) * progress,
    height: base.height + (area.height - base.height) * progress,
  };
}

/**
 * Сведённый рисунок фото: готовые слои из памяти — инструмент отдаёт их
 * сам, — иначе собираются один раз.
 */
function useDrawingLayers(
  id: string,
  image: SkImage | null,
  drawing: PhotoDrawing | undefined,
): DrawingLayers {
  return useMemo(
    () => (image ? safeDrawingLayersOf(id, image, drawing) : NO_LAYERS),
    [drawing, id, image],
  );
}

type SkiaLayer = { image: SkImage; adjust: LiveAdjust; plain: PhotoCrop };

/**
 * Правка на Skia: рабочая копия и сохранённые значения ползунков. Копия
 * готовится заранее, как только фото стало активным, — к заходу в
 * инструмент она уже есть. Показывается слой, только когда есть что
 * показать: правка или открытый инструмент.
 */
function useEditedImage(
  asset: MediaLibraryItem,
  edit: PhotoEdit | undefined,
  isActive: boolean,
  isLive: boolean,
): SkiaLayer | null {
  const needed = edit !== undefined || isLive;
  const [image, setImage] = useState<SkImage | null>(null);

  const exposure = useSharedValue(edit?.adjust.exposure ?? 0);
  const contrast = useSharedValue(edit?.adjust.contrast ?? 0);
  const saturation = useSharedValue(edit?.adjust.saturation ?? 0);
  const original = useSharedValue(0);

  // До отрисовки: на «Готово» страница переходит с ползунков инструмента на
  // свои значения, и кадр с прежними мигнул бы оригиналом.
  useLayoutEffect(() => {
    exposure.value = edit?.adjust.exposure ?? 0;
    contrast.value = edit?.adjust.contrast ?? 0;
    saturation.value = edit?.adjust.saturation ?? 0;
  }, [contrast, edit, exposure, saturation]);

  useEffect(() => {
    if (image || !(needed || isActive)) return;

    let cancelled = false;
    const load = () =>
      void workingCopyOf(asset.id)
        .then((copy) => {
          if (!cancelled) setImage(workingImageOf(asset.id, copy));
        })
        .catch(() => undefined);
    // Фото, мимо которого пролистали, рабочая копия не нужна: она дорогая
    // (раскодировать снимок, записать PNG). Нужна — у правленого, в открытом
    // инструменте и у фото, на котором задержались: к заходу в инструмент
    // она уже готова.
    const timer = needed ? null : setTimeout(load, PREPARE_AFTER_MS);

    if (needed) load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [asset.id, image, isActive, needed]);

  const adjust = useMemo(
    () => ({ exposure, contrast, saturation, original }),
    [contrast, exposure, original, saturation],
  );

  // Без обрезки — фото целиком, по пропорциям самой копии.
  const plain = useMemo(() => defaultCrop(image ? image.height() / image.width() : 1), [image]);

  return image && needed ? { image, adjust, plain } : null;
}
