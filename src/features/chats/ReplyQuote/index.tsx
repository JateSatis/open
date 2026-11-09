import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { QuotedMessage } from '@/api/chats';
import { Text } from '@/components/Text';
import { DELETED_ACCOUNT, describePreview } from '@/features/chats/messageQuote';
import { MediaThumb } from '@/features/chats/MediaThumb';
import { useTheme } from '@/hooks/use-theme';

export type ReplyQuoteProps = {
  /** Цитаты ответа в порядке переписки: сверху старые, снизу новые. */
  quotes: QuotedMessage[];
  isOwn: boolean;
  /** Подпись удалённого оригинала; по умолчанию — «Сообщение удалено». */
  deletedText?: string;
};

type QuoteLineProps = {
  quote: QuotedMessage;
  isOwn: boolean;
  deletedText: string;
};

const DELETED_TEXT = 'Сообщение удалено';

/**
 * Одна цитата: полоска, автор и фрагмент оригинала. Высота всегда одна — две
 * строки, — поэтому облачко не прыгает, чем бы ни оказался оригинал: текстом,
 * фото или удалённым сообщением. Мемо — у ответа их бывает до сотни, а
 * облачко перерисовывается от каждой реакции.
 */
const QuoteLine = memo(function QuoteLine({
  quote,
  isOwn,
  deletedText,
}: QuoteLineProps) {
  const theme = useTheme();
  const accentColor = isOwn ? theme.primaryText : theme.primary;
  const textColor = isOwn ? 'primaryText' : 'text';
  const live = quote.state === 'live' ? quote : null;
  const author = live ? (live.authorName ?? DELETED_ACCOUNT) : null;
  const snippet = live ? describePreview(live.preview) : deletedText;
  const thumbnailUrl = live?.preview.thumbnailUrl ?? null;

  return (
    <Pressable
      testID="reply-quote"
      accessibilityRole="button"
      accessibilityLabel={author ? `Ответ на сообщение: ${author}. ${snippet}` : snippet}
      disabled
      style={[
        styles.quote,
        { backgroundColor: isOwn ? theme.quoteBackgroundOnPrimary : theme.quoteBackground },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accentColor }]} />

      {thumbnailUrl ? (
        <MediaThumb
          uri={thumbnailUrl}
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
    </Pressable>
  );
});

/**
 * Цитаты в облачке ответа — столбиком, каждая сама по себе: у ответа на
 * несколько сообщений видно всё, на что он отвечает.
 */
export function ReplyQuote({
  quotes,
  isOwn,
  deletedText = DELETED_TEXT,
}: ReplyQuoteProps) {
  if (quotes.length === 0) return null;

  return (
    <View style={styles.list}>
      {quotes.map((quote, index) => (
        <QuoteLine
          // Цитата может встретиться дважды только как удалённая заглушка —
          // позиция в ответе и есть её место.
          key={`${quote.messageId}:${index}`}
          quote={quote}
          isOwn={isOwn}
          deletedText={deletedText}
        />
      ))}
    </View>
  );
}
