import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { ForwardedCommentPop } from '@/api/chats';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type PopQuoteProps = {
  /** `null` — поп удалён: заглушка, тап ничего не открывает. */
  pop: ForwardedCommentPop | null;
  /** Канал попа — строкой над подписью, как автор у цитаты сообщения. */
  channelName: string | null;
  isOwn: boolean;
};

/** Первая строка подписи попа, иначе — «🎬 Pop». */
export function popQuoteText(pop: ForwardedCommentPop): string {
  const firstLine = pop.caption?.split('\n').find((line) => line.trim().length > 0)?.trim();

  return firstLine || '🎬 Pop';
}

/**
 * Цитата попа над пересланным комментарием к нему: вертикальная обложка,
 * канал и подпись. Вид — как у цитаты сообщения, только обложка вытянута,
 * как сам поп.
 */
export function PopQuote({ pop, channelName, isOwn }: PopQuoteProps) {
  const theme = useTheme();
  const accentColor = isOwn ? theme.primaryText : theme.primary;
  const snippet = pop ? popQuoteText(pop) : 'Поп удалён';

  return (
    <Pressable
      testID="pop-quote"
      accessibilityLabel={pop ? `Поп: ${snippet}` : snippet}
      disabled
      style={[
        styles.popQuote,
        { backgroundColor: isOwn ? theme.quoteBackgroundOnPrimary : theme.quoteBackground },
      ]}
    >
      <View style={[styles.popQuoteAccent, { backgroundColor: accentColor }]} />

      {pop ? (
        <Image
          testID="pop-quote-cover"
          source={{ uri: pop.posterUrl }}
          style={[styles.popQuoteCover, { backgroundColor: theme.viewerBackground }]}
          contentFit="cover"
          recyclingKey={pop.id}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={styles.popQuoteBody}>
        {pop && channelName ? (
          <Text variant="smallBold" numberOfLines={1} style={{ color: accentColor }}>
            {channelName}
          </Text>
        ) : null}
        <Text
          variant="small"
          color={pop ? (isOwn ? 'primaryText' : 'text') : isOwn ? 'primaryText' : 'textSecondary'}
          numberOfLines={1}
          style={pop ? undefined : styles.popQuoteDeleted}
        >
          {snippet}
        </Text>
      </View>
    </Pressable>
  );
}
