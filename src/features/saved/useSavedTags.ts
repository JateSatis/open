import { useQuery } from '@tanstack/react-query';

import { listSavedTags, type SavedTag } from '@/api/saved';
import { savedTagsQueryKey } from '@/features/saved/keys';

const NO_TAGS: SavedTag[] = [];

/** Свои теги, самые используемые первыми. */
export function useSavedTags() {
  const query = useQuery({ queryKey: savedTagsQueryKey, queryFn: listSavedTags });

  return { tags: query.data ?? NO_TAGS, isLoading: query.isLoading };
}
