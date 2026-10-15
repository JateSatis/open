import { plural } from '@/lib/plural';

/** «12 345» — разряды через неразрывный пробел, чтобы число не рвалось строкой. */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** «2 читателя» — подписчики, у которых канал в «Чатах». Подпись шапки на «Постах». */
export function readersLabel(n: number): string {
  return `${formatCount(n)} ${plural(n, 'читатель', 'читателя', 'читателей')}`;
}

/** «3 подписчика» — все подписавшиеся. Подпись шапки на «Попсах». */
export function subscribersLabel(n: number): string {
  return `${formatCount(n)} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`;
}
