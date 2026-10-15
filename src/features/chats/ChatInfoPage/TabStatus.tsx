import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { LoadFailed } from '@/components/LoadFailed';
import { Spacing } from '@/theme';

export type TabStatusProps = {
  /** Что с загрузкой страниц вкладки. */
  state: 'idle' | 'loading-more' | 'paused' | 'failed';
  /** Что не загрузилось — «медиа», «голосовые». */
  what: string;
  onRetry: () => void;
};

/**
 * Хвост вкладки: подгрузка следующей страницы, нет связи, сбой — с повтором.
 * Сырые ошибки сюда не попадают, только фраза для человека.
 */
export function TabStatus({ state, what, onRetry }: TabStatusProps) {
  if (state === 'idle') return null;

  if (state === 'loading-more') {
    return (
      <View style={styles.box}>
        <ActivityIndicator accessibilityLabel="Загрузка" />
      </View>
    );
  }

  return (
    <View style={styles.box} testID="info-tab-error">
      <LoadFailed
        message={
          state === 'paused'
            ? `Нет соединения — ${what} загрузятся, когда сеть появится`
            : `Не удалось загрузить ${what}`
        }
        onRetry={onRetry}
      />
    </View>
  );
}

type InfiniteLike = {
  data: unknown;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  status: 'pending' | 'error' | 'success';
};

/** Состояние хвоста по бесконечному запросу React Query. */
export function tabStatusOf(query: InfiniteLike): TabStatusProps['state'] {
  if (query.fetchStatus === 'paused') return 'paused';
  if (query.isFetchingNextPage) return 'loading-more';
  if (query.isFetchNextPageError) return 'failed';
  if (query.data === undefined && query.status === 'error') return 'failed';

  return 'idle';
}

const styles = StyleSheet.create({
  box: {
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
});
