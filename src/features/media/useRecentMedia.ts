import { useCallback, useEffect, useRef, useState } from 'react';

import { MediaLimits } from './constants';
import { queryRecentMedia, requestMediaLibraryAccess, type MediaLibraryItem } from './mediaLibrary';

export type RecentMediaStatus = 'checking' | 'granted' | 'denied';

export type RecentMediaState = {
  status: RecentMediaStatus;
  items: MediaLibraryItem[];
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  requestAccess: () => void;
};

/**
 * Запрашивает доступ к галерее один раз при первом открытии шита и дальше
 * подгружает последние фото и видео страницами — грид не про «весь диск»,
 * а про то, что можно быстро проскроллить.
 */
export function useRecentMedia(): RecentMediaState {
  const [status, setStatus] = useState<RecentMediaStatus>('checking');
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

  const loadPage = useCallback(async () => {
    if (loadingRef.current) return;

    loadingRef.current = true;
    setIsLoadingMore(true);

    try {
      const page = await queryRecentMedia({ offset: offsetRef.current });

      offsetRef.current += page.length;
      setItems((current) => [...current, ...page]);
      setHasMore(page.length === MediaLimits.gallery.pageSize);
    } finally {
      loadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, []);

  const requestAccess = useCallback(() => {
    let cancelled = false;

    void requestMediaLibraryAccess().then((access) => {
      if (cancelled) return;

      setStatus(access);
      if (access === 'granted') void loadPage();
    });

    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  useEffect(() => requestAccess(), [requestAccess]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;

    void loadPage();
  }, [hasMore, isLoadingMore, loadPage]);

  return { status, items, isLoadingMore, hasMore, loadMore, requestAccess };
}
