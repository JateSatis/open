import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Pop } from '@/api/pops';
import { PopCover } from '@/features/pops/PopCover';
import { useTheme } from '@/hooks/use-theme';
import { Opacity } from '@/theme';

/** Опубликованный поп в сетке. */
type PublishedTileProps = {
  pop: Pop;
  /** Нет — тап ничего не делает. */
  onPress?: (pop: Pop) => void;
  /** Взять нельзя: притушена и не нажимается. */
  disabled?: boolean;
  showDuration?: boolean;
  /** Просмотры внизу слева. */
  showViews?: boolean;
  /** Удержание — во вкладке «Pop» шита открывает предпросмотр. */
  onLongPress?: (pop: Pop) => void;
};

export const PublishedPopTile = memo(function PublishedPopTile({
  pop,
  onPress,
  disabled = false,
  showDuration = false,
  showViews = false,
  onLongPress,
}: PublishedTileProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="pop-tile"
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel="Поп"
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={() => onPress?.(pop)}
      onLongPress={onLongPress ? () => onLongPress(pop) : undefined}
      style={styles.fill}
    >
      <PopCover
        posterUri={pop.posterUrl}
        durationMs={showDuration ? pop.durationMs : null}
        showLabel={false}
        recyclingKey={pop.id}
        viewsCount={showViews ? pop.viewsCount : null}
      />
      {disabled ? (
        <View
          testID="pop-tile-unavailable"
          style={[styles.fill, { backgroundColor: theme.background, opacity: Opacity.unavailable }]}
        />
      ) : null}
    </Pressable>
  );
});
