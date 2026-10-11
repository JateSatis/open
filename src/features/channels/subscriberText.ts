import { plural } from '@/lib/plural';

/** «2 читателя» — подписчики, у которых канал в «Чатах». Подпись шапки на «Постах». */
export function readersLabel(n: number): string {
  return `${n} ${plural(n, 'читатель', 'читателя', 'читателей')}`;
}

/** «3 подписчика» — все подписавшиеся. Подпись шапки на «Попсах». */
export function subscribersLabel(n: number): string {
  return `${n} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`;
}
