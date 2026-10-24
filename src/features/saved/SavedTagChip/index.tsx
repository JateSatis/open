import { Pressable, type LayoutChangeEvent } from 'react-native';

import { styles } from './styles';

import type { SavedTag } from '@/api/saved';
import { Text } from '@/components/Text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { savedTagTone } from '@/theme';

export type SavedTagChipProps = {
  tag: SavedTag;
  selected: boolean;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** На плашке цвета фона элемента (меню): невыбранный — на тон темнее, иначе не виден. */
  onElement?: boolean;
};

/** Чип тега: выбранный — в цвете тега, невыбранный — серый. */
export function SavedTagChip({
  tag,
  selected,
  onPress,
  onLayout,
  onElement = false,
}: SavedTagChipProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const tone = savedTagTone(scheme, tag.color);

  return (
    <Pressable
      testID={`saved-tag-${tag.name}`}
      accessibilityRole="checkbox"
      accessibilityLabel={tag.name}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      onLayout={onLayout}
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? tone.fill
            : onElement
              ? theme.backgroundSelected
              : theme.backgroundElement,
        },
      ]}
    >
      <Text
        variant="smallBold"
        numberOfLines={1}
        style={{ color: selected ? tone.text : theme.textSecondary }}
      >
        {tag.name}
      </Text>
    </Pressable>
  );
}
