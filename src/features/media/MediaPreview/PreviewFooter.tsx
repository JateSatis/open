import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PreviewTools } from './PreviewTools';
import { styles } from './styles';

import { claimKeyboardForSheet } from '@/features/chats/composerKeyboard';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

/** Подпись к отправке — тот же черновик, что в поле шита и чата. */
export type PreviewCaption = {
  text: string;
  onChangeText: (text: string) => void;
  placeholder: string;
};

/** Что делает кнопка справа: отправить, сохранить правку альбома, поставить аватарку. */
export type PreviewAction = 'send' | 'save' | 'avatar';

export type PreviewFooterProps = {
  assetId: string;
  isPhoto: boolean;
  /** Нет — поля подписи нет (шит аватарки), кнопка встаёт в ряд инструментов. */
  caption?: PreviewCaption;
  action: PreviewAction;
  style: AnimatedStyle<ViewStyle>;
  /** Открыт инструмент: низ спрятан и не принимает касаний. */
  hidden: boolean;
  onSend: () => void;
  onOpenColor: () => void;
  onOpenCrop: () => void;
  onOpenDraw: () => void;
  onLayout: (height: number) => void;
};

const ACTIONS: Record<PreviewAction, { label: string; icon: SymbolViewProps['name'] }> = {
  send: {
    label: 'Отправить',
    icon: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  },
  save: { label: 'Сохранить', icon: { ios: 'checkmark', android: 'check', web: 'check' } },
  avatar: { label: 'Поставить фото', icon: { ios: 'checkmark', android: 'check', web: 'check' } },
};

/**
 * Низ предпросмотра: подпись — тот же черновик, что в поле шита и чата, —
 * отправка и ряд инструментов фото. Без подписи (шит аватарки) кнопка
 * стоит справа в ряду инструментов.
 */
export function PreviewFooter({
  assetId,
  isPhoto,
  caption,
  action,
  style,
  hidden,
  onSend,
  onOpenColor,
  onOpenCrop,
  onOpenDraw,
  onLayout,
}: PreviewFooterProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sendButton = (
    <Pressable
      testID="media-preview-send"
      accessibilityRole="button"
      accessibilityLabel={ACTIONS[action].label}
      onPress={onSend}
      style={[styles.sendButton, { backgroundColor: theme.primary }]}
    >
      <SymbolView name={ACTIONS[action].icon} size={Spacing.four} tintColor={theme.primaryText} />
    </Pressable>
  );

  return (
    <Animated.View
      testID="media-preview-footer"
      pointerEvents={hidden ? 'none' : 'auto'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      style={[
        styles.footer,
        { paddingBottom: insets.bottom + Spacing.two, backgroundColor: theme.mediaScrim },
        style,
      ]}
      onLayout={(event) => onLayout(event.nativeEvent.layout.height)}
    >
      {caption ? (
        <View style={styles.captionRow}>
          <TextInput
            testID="media-preview-caption"
            accessibilityLabel="Подпись"
            placeholder={caption.placeholder}
            placeholderTextColor={theme.textOnMediaSecondary}
            value={caption.text}
            onChangeText={caption.onChangeText}
            multiline
            onPressIn={claimKeyboardForSheet}
            onFocus={claimKeyboardForSheet}
            style={[
              styles.captionField,
              { color: theme.textOnMedia, backgroundColor: theme.mediaControl },
            ]}
          />
          {sendButton}
        </View>
      ) : null}

      {isPhoto || !caption ? (
        <View style={styles.toolsRow}>
          {isPhoto ? (
            <PreviewTools
              assetId={assetId}
              onOpenColor={onOpenColor}
              onOpenCrop={onOpenCrop}
              onOpenDraw={onOpenDraw}
            />
          ) : null}
          {caption ? null : sendButton}
        </View>
      ) : null}
    </Animated.View>
  );
}
