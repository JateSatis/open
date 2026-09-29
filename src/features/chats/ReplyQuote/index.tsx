import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { QuotedMessage } from '@/api/chats';
import { Text } from '@/components/Text';
import { DELETED_ACCOUNT, describePreview } from '@/features/chats/messageQuote';
import { useTheme } from '@/hooks/use-theme';

export type ReplyQuoteProps = {
  /** Цитаты ответа по порядку; показывается первая, остальные — «+N». */
  quotes: QuotedMessage[];
  isOwn: boolean;
  /** Тап — прыжок к оригиналу. Нет обработчика — цитата не нажимается. */
  onPress?: () => void;
};

/**
 * Цитата в облачке ответа: полоска, автор и фрагмент оригинала. Высота
 * всегда одна — две строки, — поэтому облачко не прыгает, чем бы ни
 * оказался оригинал: текстом, фото или удалённым сообщением.
 */
export function ReplyQuote({ quotes, isOwn, onPress }: ReplyQuoteProps) {
  const theme = useTheme();
  const [first] = quotes;

  if (!first) return null;

  const accentColor = isOwn ? theme.primaryText : theme.primary;
  const textColor = isOwn ? 'primaryText' : 'text';
  const more = quotes.length - 1;
  const live = first.state === 'live' ? first : null;
  const author = live ? (live.authorName ?? DELETED_ACCOUNT) : null;
  const snippet = live ? describePreview(live.preview) : 'Сообщение удалено';
  const thumbnailUrl = live?.preview.thumbnailUrl ?? null;
  const anyLive = quotes.some((quote) => quote.state === 'live');

  return (
    <Pressable
      testID="reply-quote"
      accessibilityRole="button"
      accessibilityLabel={author ? `Ответ на сообщение: ${author}. ${snippet}` : snippet}
      // По удалённому оригиналу тап ничего не делает.
      disabled={!onPress || !anyLive}
      onPress={onPress}
      style={[
        styles.quote,
        { backgroundColor: isOwn ? theme.quoteBackgroundOnPrimary : theme.quoteBackground },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accentColor }]} />

      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={styles.body}>
        {author ? (
          <Text variant="smallBold" numberOfLines={1} style={{ color: accentColor }}>
            {author}
          </Text>
        ) : null}
        <Text
          variant="small"
          color={live ? textColor : isOwn ? 'primaryText' : 'textSecondary'}
          numberOfLines={1}
          style={live ? undefined : styles.deleted}
        >
          {snippet}
        </Text>
      </View>

      {more > 0 ? (
        <Text variant="smallBold" style={{ color: accentColor }}>
          {`+${more}`}
        </Text>
      ) : null}
    </Pressable>
  );
}
