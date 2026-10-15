import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SearchPop } from '@/api/search';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { PopCover } from '@/features/pops/PopCover';
import { HighlightedText } from '@/features/search/HighlightedText';
import { findMatches } from '@/features/search/searchText';
import { Sizes } from '@/theme';

export type SearchPopTileProps = {
  pop: SearchPop;
  /** Нормализованный текст запроса — для подсветки. */
  needle: string;
  width: number;
  onPress: (pop: SearchPop) => void;
};

/** Что подписать под обложкой: название, у старых попсов — начало подписи. */
function labelOf(pop: SearchPop): string {
  return (pop.title ?? pop.caption ?? '').replace(/\s/g, ' ');
}

/**
 * Плитка выдачи поиска «Ленты»: вертикальная обложка с просмотрами, под ней
 * название в две строки с подсветкой совпадения, ниже — канал. Высота
 * обложки — от ширины колонки, а не от загрузки постера: сетка не прыгает.
 */
export const SearchPopTile = memo(function SearchPopTile({
  pop,
  needle,
  width,
  onPress,
}: SearchPopTileProps) {
  const label = labelOf(pop);

  return (
    <Pressable
      testID="search-pop"
      accessibilityRole="button"
      accessibilityLabel={label || 'Поп'}
      onPress={() => onPress(pop)}
      style={[styles.tile, { width }]}
    >
      <View style={[styles.cover, { width, height: width / Sizes.popAspect }]}>
        <PopCover
          posterUri={pop.posterUrl}
          showLabel={false}
          recyclingKey={pop.id}
          viewsCount={pop.viewsCount}
        />
      </View>
      <HighlightedText
        testID="search-pop-title"
        variant="small"
        numberOfLines={2}
        style={styles.title}
        ranges={findMatches(label, needle)}
      >
        {label}
      </HighlightedText>
      <View style={styles.channel}>
        <Avatar uri={pop.channelAvatarUrl} name={pop.channelTitle} size={Sizes.searchPopAvatar} />
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.channelTitle}>
          {pop.channelTitle}
        </Text>
      </View>
    </Pressable>
  );
});
