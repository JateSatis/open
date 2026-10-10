import { useState } from 'react';
import { Pressable, View, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

/** Свёрнутая подпись — две строки, как в TikTok. */
const COLLAPSED_LINES = 2;

export type PopCaptionProps = {
  channelTitle: string | null;
  caption: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenChannel: () => void;
};

/**
 * Внизу слева: имя канала жирно и под ним подпись в две строки. Не влезла —
 * «ещё», и тап раскрывает её целиком поверх затемнения (затемнение рисует
 * страница).
 */
export function PopCaption({
  channelTitle,
  caption,
  expanded,
  onToggle,
  onOpenChannel,
}: PopCaptionProps) {
  const theme = useTheme();
  const shadow = [styles.onMediaText, { textShadowColor: theme.shadow }];
  // Сколько строк у полной подписи — по невидимой копии: обрезанная сама об этом не скажет.
  const [overflows, setOverflows] = useState(false);

  const measure = (event: NativeSyntheticEvent<TextLayoutEventData>) =>
    setOverflows(event.nativeEvent.lines.length > COLLAPSED_LINES);

  return (
    <View style={styles.caption} pointerEvents="box-none">
      <Pressable
        testID="pop-channel-name"
        accessibilityRole="link"
        onPress={onOpenChannel}
        hitSlop={8}
        style={styles.channelName}
      >
        <Text variant="bodyBold" color="textOnMedia" numberOfLines={1} style={shadow}>
          {channelTitle ?? ' '}
        </Text>
      </Pressable>

      {caption ? (
        <Pressable
          testID="pop-caption"
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          disabled={!overflows && !expanded}
          onPress={onToggle}
        >
          <Text
            variant="small"
            color="textOnMedia"
            numberOfLines={expanded ? undefined : COLLAPSED_LINES}
            style={shadow}
          >
            {caption}
          </Text>
          {overflows && !expanded ? (
            <Text testID="pop-caption-more" variant="smallBold" color="textOnMedia" style={shadow}>
              ещё
            </Text>
          ) : null}
          <Text
            variant="small"
            style={styles.measure}
            onTextLayout={measure}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {caption}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
