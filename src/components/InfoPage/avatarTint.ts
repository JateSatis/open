import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';

/** Сторона уменьшенной картинки: средний цвет по 8×8 точкам — уже не шум, а тон. */
const SAMPLE = 8;

/**
 * Основной цвет аватарки по адресу — на всю жизнь процесса. Повторное
 * открытие страницы берёт его отсюда, и подкрашенный градиент стоит в первом
 * же кадре.
 */
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function toHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');
}

/**
 * Средний цвет картинки, чуть насыщеннее среднего: усреднение по всей
 * картинке сереет, а градиент должен узнаваться по фото.
 */
export function averageColor(pixels: ArrayLike<number>): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;

    r += pixels[i] * alpha;
    g += pixels[i + 1] * alpha;
    b += pixels[i + 2] * alpha;
    weight += alpha;
  }

  if (weight === 0) return null;

  r /= weight;
  g /= weight;
  b /= weight;

  const mean = (r + g + b) / 3;
  const boost = 1.35;

  return `#${toHex(mean + (r - mean) * boost)}${toHex(mean + (g - mean) * boost)}${toHex(mean + (b - mean) * boost)}`;
}

async function computeTint(uri: string): Promise<string | null> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);

  if (!image) return null;

  const surface = Skia.Surface.Make(SAMPLE, SAMPLE);

  if (!surface) return null;

  surface
    .getCanvas()
    .drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, SAMPLE, SAMPLE),
      Skia.Paint(),
    );
  surface.flush();

  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: SAMPLE,
    height: SAMPLE,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });

  return pixels ? averageColor(pixels) : null;
}

/** Цвет аватарки из памяти, если уже считали. */
export function cachedTint(uri: string | null): string | null {
  return uri ? (cache.get(uri) ?? null) : null;
}

function loadTint(uri: string): Promise<string | null> {
  const existing = pending.get(uri);

  if (existing) return existing;

  const promise = computeTint(uri)
    .then((tint) => {
      if (tint) cache.set(uri, tint);
      return tint;
    })
    .catch(() => null)
    .finally(() => pending.delete(uri));

  pending.set(uri, promise);

  return promise;
}

/**
 * Основной цвет аватарки для градиента шапки. Пока считается — null
 * (нейтральный фон), посчитанный — из памяти сразу.
 */
export function useAvatarTint(uri: string | null): string | null {
  const [loaded, setLoaded] = useState<{ uri: string; tint: string | null } | null>(null);

  useEffect(() => {
    if (!uri || cache.has(uri)) return;

    let alive = true;

    void loadTint(uri).then((tint) => {
      if (alive) setLoaded({ uri, tint });
    });

    return () => {
      alive = false;
    };
  }, [uri]);

  if (!uri) return null;

  return cache.get(uri) ?? (loaded?.uri === uri ? loaded.tint : null);
}

/** Смешать два цвета `#rrggbb`: share = 0 — первый, 1 — второй. */
export function mixColors(from: string, to: string, share: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '');

    return [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16));
  };
  const a = parse(from);
  const b = parse(to);

  return `#${a.map((value, index) => toHex(value + (b[index] - value) * share)).join('')}`;
}
