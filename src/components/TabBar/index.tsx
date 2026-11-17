import { useNavigation } from '@/navigation';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Spacing, TabBarSizes } from '@/theme';

import { useTabBarHeight } from './useTabBarHeight';

export { useTabBarHeight };

export type TabName = 'feed' | 'chats' | 'profile';

const TABS: readonly {
  name: TabName;
  label: string;
  icon: { ios: SFSymbol; android: AndroidSymbol };
}[] = [
  { name: 'feed', label: 'Лента', icon: { ios: 'sparkles', android: 'dynamic_feed' } },
  { name: 'chats', label: 'Чаты', icon: { ios: 'message', android: 'chat' } },
  { name: 'profile', label: 'Профиль', icon: { ios: 'person.crop.circle', android: 'person' } },
];

/** Панель работает внутри навигатора MainTabs. */
type TabsNavigation = { navigate: (name: TabName) => void };

export type TabBarProps = {
  /** Вкладка экрана, на котором стоит панель. */
  active: TabName;
};

/**
 * Панель вкладок. Её рисует сам корневой экран вкладки, поверх своего
 * содержимого, — поэтому на вложенных экранах (переписка, канал, профиль
 * человека) панели нет, а при переходе туда она уезжает вместе с экраном,
 * без мигания. Сплошного фона нет: содержимое видно под дымкой (`tabBarScrim`).
 * Экран оставляет спискам нижний отступ `useTabBarHeight()`.
 */
export function TabBar({ active }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<TabsNavigation>();
  const height = useTabBarHeight();
  // До верха значков дымка плотная, растворяется — над ними.
  const solid = `${Math.round((height / (height + TabBarSizes.fadeTop)) * 100)}%`;

  return (
    <View
      testID="tab-bar"
      pointerEvents="box-none"
      style={[
        styles.bar,
        {
          paddingBottom: TabBarSizes.bottom + insets.bottom,
          experimental_backgroundImage: `linear-gradient(to top, ${theme.tabBarScrim} 0%, ${theme.tabBarScrimSoft} ${solid}, ${theme.tabBarScrimClear} 100%)`,
        },
      ]}
    >
      <View style={styles.row} accessibilityRole="tablist">
        {TABS.map((tab) => {
          const selected = tab.name === active;
          const color = selected ? theme.text : theme.textSecondary;

          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              hitSlop={{ top: Spacing.three, bottom: TabBarSizes.bottom }}
              onPress={selected ? undefined : () => navigation.navigate(tab.name)}
              style={({ pressed }) => [styles.tab, pressed && { opacity: Opacity.pressed }]}
            >
              <SymbolView
                name={{ ...tab.icon, web: tab.icon.android }}
                size={TabBarSizes.icon}
                tintColor={color}
              />
              <Text variant="tabLabel" style={{ color }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
