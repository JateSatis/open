import type { Rect } from './previewStore';

/**
 * Фото, вписанное целиком в область: длинная по отношению к области сторона
 * касается её краёв. Без известных размеров — квадрат.
 */
export function fitRect(aspect: number, area: Rect): Rect {
  'worklet';
  const ratio = aspect > 0 ? aspect : 1;
  const byWidth = area.width / ratio <= area.height;
  const width = byWidth ? area.width : area.height * ratio;
  const height = byWidth ? area.width / ratio : area.height;

  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  };
}

function lerp(from: number, to: number, progress: number): number {
  'worklet';
  return from + (to - from) * progress;
}

export type FlightTransform = {
  /** Рамка: сдвиг и масштаб по осям от базового прямоугольника. */
  frame: { translateX: number; translateY: number; scaleX: number; scaleY: number };
  /** Картинка внутри рамки: масштаб, возвращающий ей пропорции. */
  image: { scaleX: number; scaleY: number };
};

/**
 * Перелёт фото из плитки сетки во вписанное положение и обратно — одними
 * трансформами, без перевёрстки на каждом кадре.
 *
 * Рамка (с обрезкой по краям) лежит в базовом прямоугольнике `base` и
 * растягивается по осям от квадрата плитки `tile` до прямоугольника `target`.
 * Картинка внутри масштабируется равномерно — от «покрыть плитку», как она
 * выглядит в сетке, до «вписана» — и встречным масштабом гасит растяжение
 * рамки, так что пропорции фото не плывут ни на одном кадре.
 *
 * `progress` 0 — фото в плитке, 1 — на месте.
 */
export function flightTransform(
  base: Rect,
  target: Rect,
  tile: Rect | null,
  progress: number,
): FlightTransform {
  'worklet';
  const from = tile ?? target;
  const width = lerp(from.width, target.width, progress);
  const height = lerp(from.height, target.height, progress);
  const centerX = lerp(from.x + from.width / 2, target.x + target.width / 2, progress);
  const centerY = lerp(from.y + from.height / 2, target.y + target.height / 2, progress);

  const scaleX = width / base.width;
  const scaleY = height / base.height;

  // Плитка показывает фото «покрыть»: короткая сторона фото — во всю плитку.
  const startScale = tile ? Math.max(tile.width / target.width, tile.height / target.height) : 1;
  const uniform = lerp(startScale, 1, progress) * (target.width / base.width);

  return {
    frame: {
      translateX: centerX - (base.x + base.width / 2),
      translateY: centerY - (base.y + base.height / 2),
      scaleX,
      scaleY,
    },
    image: { scaleX: uniform / scaleX, scaleY: uniform / scaleY },
  };
}
