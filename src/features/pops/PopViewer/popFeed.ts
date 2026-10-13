import type { Pop } from '@/api/pops';

/**
 * Лента, которую листает просмотр: попсы по порядку и догрузка в обе
 * стороны. Откуда она — дело того, кто открыл просмотр: попсы канала
 * (`usePopFeed`) или выдача поиска (`useSearchPopFeed`). Форма — та, что
 * отдаёт бесконечный запрос React Query.
 */
export type PopFeed = {
  pops: Pop[];
  /** Первой страницы ещё нет. */
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isFetchingNextPage: boolean;
  isFetchingPreviousPage: boolean;
  fetchNextPage: () => unknown;
  fetchPreviousPage: () => unknown;
  /**
   * Имя и аватарка канала попа, пока сам канал не загружен: выдача поиска
   * приносит их вместе с попом. Нет — шапка ждёт канал.
   */
  channelOf?: (pop: Pop) => PopChannelFace | null;
};

export type PopChannelFace = { title: string; avatarUrl: string | null };
