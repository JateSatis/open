import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import type { SavedSourceLabel } from '@/features/saved/savedCopy';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing, savedTagTone } from '@/theme';

export type SavedLeadProps = {
  label: SavedSourceLabel;
  /** Копия комментария: пометка «комментарий» перед источником. */
  isComment: boolean;
  tags: SavedTag[];
  /** Тап по тегу — фильтр по нему. Нет — теги только подписи. */
  onTagPress?: (tagId: string) => void;
};

/**
 * Верх облачка сохранённого: «Источник · Автор» (у поста канала — только
 * канал, у своей заметки — «Вы»); справа — маленькие
 * цветные теги.
 */
export function SavedLead({ label, isComment, tags, onTagPress }: SavedLeadProps) {
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
          accessibilityRole="text"
          accessibilityLabel={label.source}
          variant="smallBold"
          numberOfLines={2}
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
              <Pressable
                key={tag.id}
                testID={`saved-bubble-tag-${tag.name}`}
                accessibilityRole={onTagPress ? 'button' : 'text'}
                accessibilityLabel={onTagPress ? `Фильтр по тегу ${tag.name}` : tag.name}
                disabled={!onTagPress}
                onPress={() => onTagPress?.(tag.id)}
                // Тег маленький: касание шире самого чипа, до рекомендованного.
                hitSlop={Spacing.two}
                style={[styles.tag, { backgroundColor: tone.fill }]}
              >
                <Text variant="meta" numberOfLines={1} style={{ color: tone.text }}>
                  {tag.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
