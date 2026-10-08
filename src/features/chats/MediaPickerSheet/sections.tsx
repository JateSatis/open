import type { ReactElement, ReactNode } from 'react';

import type { SheetList } from './SheetList';

import { MediaGrid, type GridPick } from '@/features/media';

/**
 * Что шит отдаёт разделу. Движением шита владеет его список, поэтому раздел
 * рисует свои строки только в `List` и ставит `header` первой строкой, а
 * `footer` — последней: шапка — это ход шита и ручка, хвост — место под
 * строкой ввода и вкладками.
 */
export type SheetSectionSlot = {
  List: typeof SheetList;
  header: ReactElement;
  footer: ReactElement;
  /** Содержимое не короче окна шита — иначе под ним просвечивал бы чат. */
  minContentHeight: number;
  /** Шит выбора одного файла (`MediaPickSheet`). */
  pick?: GridPick;
};

/**
 * Раздел шита медиа — вкладка внизу шита: ключ, подпись и содержимое. Набор
 * разделов задаёт владелец шита по виду чата; новый раздел (файлы, аудио,
 * голосования) — новый элемент набора, ядро шита о нём не знает. Правила
 * совместимости раздел держит сам: например, попсы притушены, пока выбраны
 * фото из галереи.
 */
export type SheetSection = {
  key: string;
  label: string;
  /** Под клетками — скелет сетки галереи: место под файлы, которые ещё читаются. */
  skeleton?: boolean;
  render: (slot: SheetSectionSlot) => ReactNode;
};

export type GallerySectionOptions = {
  /** Галерею сейчас взять нельзя (к посту прикреплён поп). */
  locked?: boolean;
};

/** Галерея устройства: отбор фото и видео в сообщение или выбор одного файла. */
export function gallerySection({ locked = false }: GallerySectionOptions = {}): SheetSection {
  return {
    key: 'gallery',
    label: 'Галерея',
    skeleton: true,
    render: ({ List, header, footer, minContentHeight, pick }) => (
      <MediaGrid
        ListComponent={List}
        header={header}
        footer={footer}
        pick={pick}
        locked={locked}
        minContentHeight={minContentHeight}
      />
    ),
  };
}

/** Обычный чат, комментарии и выбор одного файла: только галерея, вкладок нет. */
export const GALLERY_ONLY: SheetSection[] = [gallerySection()];
