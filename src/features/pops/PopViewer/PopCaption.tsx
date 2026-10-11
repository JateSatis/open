import { useState } from 'react';
import { Pressable, View, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** Свёрнутая подпись — две строки, как в TikTok. */
const COLLAPSED_LINES = 2;

/** Кнопка подписки у имени канала: «Подписаться» или «Добавить в чаты». */
export type PopSubscribeAction = { label: string; onPress: () => void };

export type PopCaptionProps = {
  channelTitle: string | null;
  channelAvatarUrl: string | null;
  /** Нет — кнопки нет: я читатель или публикую в канале. */
  subscribe: PopSubscribeAction | null;
  caption: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenChannel: () => void;
};

/**
 * Внизу слева: аватарка и имя канала, справа от них — кнопка подписки, под
 * ними подпись в две строки. Не влезла —
 * «ещё», и тап раскрывает её целиком поверх затемнения (затемнение рисует
 * страница).
 */
export function PopCaption({
  channelTitle,
  channelAvatarUrl,
  subscribe,
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
      <View style={styles.channelRow} pointerEvents="box-none">
        <Pressable
          testID="pop-channel-name"
          accessibilityRole="link"
          accessibilityLabel={channelTitle ?? 'Канал'}
          onPress={onOpenChannel}
          hitSlop={Spacing.two}
          style={styles.channelName}
        >
          <Avatar uri={channelAvatarUrl} name={channelTitle ?? ' '} size={Sizes.popChannelAvatar} />
          <Text
            variant="bodyBold"
            color="textOnMedia"
            numberOfLines={1}
            style={[styles.channelTitle, shadow]}
          >
            {channelTitle ?? ' '}
          </Text>
        </Pressable>

        {subscribe ? (
          <Pressable
            testID="pop-subscribe"
            accessibilityRole="button"
            accessibilityLabel={subscribe.label}
            onPress={subscribe.onPress}
            hitSlop={Spacing.one}
            style={[styles.subscribe, { borderColor: theme.textOnMedia }]}
          >
            <Text variant="smallBold" color="textOnMedia" numberOfLines={1} style={shadow}>
              {subscribe.label}
            </Text>
          </Pressable>
        ) : null}
      </View>

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
