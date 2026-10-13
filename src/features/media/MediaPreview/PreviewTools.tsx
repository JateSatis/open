import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { usePhotoEdit } from '@/features/media/photoEdits/editsStore';
import { hasCrop, hasDrawing, isNeutralAdjust } from '@/features/media/photoEdits/types';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type PreviewToolsProps = {
  assetId: string;
  onOpenColor: () => void;
  onOpenCrop: () => void;
  onOpenDraw: () => void;
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

/**
 * Ряд инструментов фото. Иконка инструмента подсвечена, если у этого фото
 * есть его правки. Наложения — следующий этап: место в ряду уже есть, но на
 * тап оно пока не отвечает.
 */
export function PreviewTools({ assetId, onOpenColor, onOpenCrop, onOpenDraw }: PreviewToolsProps) {
  const theme = useTheme();
  const edit = usePhotoEdit(assetId);

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

  return (
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
  );
}
