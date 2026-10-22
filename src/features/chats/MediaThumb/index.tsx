import { Image, type ImageProps } from 'expo-image';

import { useMediaSource } from '@/hooks/use-media-source';

export type MediaThumbProps = Omit<ImageProps, 'source'> & {
  /** Путь в `chat-media`, адрес попа или локальный файл. */
  uri: string | null | undefined;
};

/**
 * Миниатюра вложения в цитате, закрепе, плашке ответа и правке: путь в
 * закрытом бакете показывается по подписанной ссылке с кешем по пути. Пока
 * ссылки нет (или медиа скрыто) — ничего, фон под миниатюрой остаётся.
 */
export function MediaThumb({ uri, ...props }: MediaThumbProps) {
  const source = useMediaSource(uri);

  return source ? <Image source={source} {...props} /> : null;
}
