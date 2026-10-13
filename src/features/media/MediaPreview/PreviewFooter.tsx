import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { claimKeyboardForSheet } from '@/features/chats/composerKeyboard';
import { usePhotoEdit } from '@/features/media/photoEdits/editsStore';
import { hasCrop, hasDrawing, isNeutralAdjust } from '@/features/media/photoEdits/types';
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

type ToolKey = 'crop' | 'draw' | 'overlay' | 'color';

const TOOLS: { key: ToolKey; label: string; icon: SymbolViewProps['name'] }[] = [
  {
    key: 'crop',
    label: 'Обрезка и поворот',
    icon: { ios: 'crop.rotate', android: 'crop_rotate', web: 'crop_rotate' },
  },
  { key: 'draw', label: 'Рисование', icon: { ios: 'pencil.tip', android: 'draw', web: 'draw' } },
  {
    key: 'overlay',
    label: 'Наложения',
    icon: { ios: 'face.smiling', android: 'add_reaction', web: 'add_reaction' },
  },
  {
    key: 'color',
    label: 'Настройка цвета',
    icon: { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' },
  },
];

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
 * стоит справа в ряду инструментов. Иконка инструмента подсвечена, если у
 * этого фото есть его правки. Наложения — следующий этап: место в ряду
 * уже есть, но на тап оно пока не отвечает.
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
  const edit = usePhotoEdit(isPhoto ? assetId : null);

  // Подсветка — по инструментам: горит тот, чьи правки у фото есть.
  const edited: Record<ToolKey, boolean> = {
    crop: hasCrop(edit),
    draw: hasDrawing(edit),
    overlay: false,
    color: edit !== undefined && !isNeutralAdjust(edit.adjust),
  };
  const opens: Partial<Record<ToolKey, () => void>> = {
    crop: onOpenCrop,
    draw: onOpenDraw,
    color: onOpenColor,
  };

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
            <View style={styles.tools}>
              {TOOLS.map((tool) => {
                const onOpen = opens[tool.key];

                return (
                  <Pressable
                    key={tool.key}
                    testID={`media-preview-tool-${tool.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={tool.label}
                    // Наложения — следующий этап: место в ряду есть, нажать нельзя.
                    disabled={!onOpen}
                    accessibilityState={{ selected: edited[tool.key], disabled: !onOpen }}
                    onPress={
                      onOpen
                        ? () => {
                            void Haptics.selectionAsync();
                            onOpen();
                          }
                        : undefined
                    }
                    style={styles.tool}
                  >
                    <SymbolView
                      name={tool.icon}
                      size={Spacing.four}
                      tintColor={edited[tool.key] ? theme.primary : theme.textOnMedia}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {caption ? null : sendButton}
        </View>
      ) : null}
    </Animated.View>
  );
}
