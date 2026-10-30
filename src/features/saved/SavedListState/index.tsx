import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import { LinkButton } from '@/components/LinkButton';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';

/**
 * Пустой список — с подсказкой, как его наполнить; под фильтрами — с
 * действием (сбросить их).
 */
export type SavedEmpty = {
  testID: string;
  title: string;
  hint?: string;
  action?: { label: string; onPress: () => void; testID?: string };
};

export type SavedListStateProps = {
  failed: boolean;
  loading: boolean;
  /** Список пуст. Нет — есть что показать. */
  empty: SavedEmpty | null;
  onRetry: () => void;
  failText: string;
  loadingLabel: string;
};

/**
 * Вкладка «Сохранённых» без списка: не загрузилось, грузится или пусто. Есть
 * что показать — ничего.
 */
export function SavedListState({
  failed,
  loading,
  empty,
  onRetry,
  failText,
  loadingLabel,
}: SavedListStateProps) {
  if (failed) return <LoadFailed message={failText} onRetry={onRetry} />;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel={loadingLabel} />
      </View>
    );
  }

  if (!empty) return null;

  return (
    <View testID={empty.testID} style={styles.centered}>
      <Text variant="bodyBold">{empty.title}</Text>
      {empty.hint ? (
        <Text color="textSecondary" style={styles.hint}>
          {empty.hint}
        </Text>
      ) : null}
      {empty.action ? (
        <View testID={empty.action.testID}>
          <LinkButton label={empty.action.label} onPress={empty.action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
