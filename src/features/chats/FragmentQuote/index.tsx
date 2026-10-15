import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { truncateGraphemes } from '@/features/chats/fragments/textOffsets';
import { styles as quoteStyles } from '@/features/chats/ReplyQuote/styles';
import { useTheme } from '@/hooks/use-theme';

/** Сколько символов цитаты видно в плашке; дальше — многоточие. */
export const FRAGMENT_QUOTE_MAX = 100;

export type FragmentQuoteProps = {
  /** Кусок, каким его выделили. `null` — сообщение удалено, цитаты нет. */
  text: string | null;
  isOwn: boolean;
  /** Тап — к куску в сообщении. Нет обработчика — плашка не нажимается. */
  onPress?: () => void;
};

/**
 * Плашка над комментарием к фрагменту — цитата выделенного куска. Геометрия
 * та же, что у цитаты ответа (`ReplyQuote`), но без строки автора: цитата
 * всегда из сообщения, под которым шит.
 */
export const FragmentQuote = memo(function FragmentQuote({
  text,
  isOwn,
  onPress,
}: FragmentQuoteProps) {
  const theme = useTheme();
  const shown = text === null ? 'Сообщение удалено' : truncateGraphemes(text, FRAGMENT_QUOTE_MAX);

  return (
    <Pressable
      testID="comment-fragment-quote"
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Цитата: ${shown}`}
      disabled={!onPress}
      onPress={onPress}
      style={[
        quoteStyles.quote,
        { backgroundColor: isOwn ? theme.quoteBackgroundOnPrimary : theme.quoteBackground },
      ]}
    >
      <View
        style={[quoteStyles.accent, { backgroundColor: isOwn ? theme.primaryText : theme.primary }]}
      />
      <Text
        variant="small"
        color={
          text === null ? (isOwn ? 'primaryText' : 'textSecondary') : isOwn ? 'primaryText' : 'text'
        }
        style={[styles.body, text === null ? quoteStyles.deleted : undefined]}
      >
        {shown}
      </Text>
    </Pressable>
  );
});
