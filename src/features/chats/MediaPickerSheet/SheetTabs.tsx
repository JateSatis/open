import { Pressable, View } from 'react-native';

import type { SheetSection } from './sections';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

export type SheetTabsProps = {
  sections: SheetSection[];
  activeKey: string;
  onSelect: (key: string) => void;
};

/** Вкладки разделов внизу шита: «Галерея» | «Pop» | … */
export function SheetTabs({ sections, activeKey, onSelect }: SheetTabsProps) {
  const theme = useTheme();

  return (
    <View
      testID="media-sheet-tabs"
      accessibilityRole="tablist"
      style={[styles.tabs, { borderTopColor: theme.border }]}
    >
      {sections.map((section) => {
        const selected = section.key === activeKey;

        return (
          <Pressable
            key={section.key}
            testID={`media-sheet-tab-${section.key}`}
            accessibilityRole="tab"
            accessibilityLabel={section.label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(section.key)}
            style={styles.tab}
          >
            <Text
              variant={selected ? 'smallBold' : 'small'}
              color={selected ? 'primary' : 'textSecondary'}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
