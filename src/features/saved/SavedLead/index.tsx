import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import type { SavedSourceLabel } from '@/features/saved/savedCopy';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, savedTagTone } from '@/theme';

export type SavedLeadProps = {
  label: SavedSourceLabel;
  /** Копия комментария: пометка «комментарий» перед источником. */
  isComment: boolean;
  tags: SavedTag[];
  onOpenSource: () => void;
};

/**
 * Верх облачка сохранённого: «Источник · Автор» (у поста канала — только
 * канал), тап — к оригиналу; справа — маленькие цветные теги.
 */
export function SavedLead({ label, isComment, tags, onOpenSource }: SavedLeadProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <View testID="saved-lead" style={styles.lead}>
      <View style={styles.source}>
        {isComment ? (
          <SymbolView
            name={{
              ios: 'bubble.left',
              android: 'chat_bubble_outline',
              web: 'chat_bubble_outline',
            }}
            size={Sizes.commentsIconQuiet}
            tintColor={theme.textSecondary}
          />
        ) : null}
        <Text
          testID="saved-source"
          accessibilityRole="link"
          accessibilityLabel={`К оригиналу: ${label.source}`}
          variant="smallBold"
          numberOfLines={2}
          onPress={onOpenSource}
          suppressHighlighting
          style={styles.sourceText}
        >
          {label.source}
          {label.author ? (
            <Text variant="small" color="textSecondary">
              {` · ${label.author}`}
            </Text>
          ) : null}
        </Text>
      </View>

      {tags.length > 0 ? (
        <View testID="saved-tags" style={styles.tags}>
          {tags.map((tag) => {
            const tone = savedTagTone(scheme, tag.color);

            return (
              <View key={tag.id} style={[styles.tag, { backgroundColor: tone.fill }]}>
                <Text variant="meta" numberOfLines={1} style={{ color: tone.text }}>
                  {tag.name}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
