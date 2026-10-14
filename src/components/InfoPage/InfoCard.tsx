import * as Clipboard from 'expo-clipboard';
import { Children, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AnchoredMenu, type MenuAnchor } from '@/components/AnchoredMenu';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Radii, Spacing } from '@/theme';

/**
 * Скруглённая плашка под шапкой. Пустая — не рисуется: строки без данных не
 * показываются, и карточка из одних таких — тоже.
 */
export function InfoCard({ children, testID }: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <View testID={testID} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      {rows}
    </View>
  );
}

type CopyItem = 'copy';
const COPY_ACTIONS = [
  {
    id: 'copy' as const,
    label: 'Копировать',
    icon: { ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' } as const,
  },
];

export type InfoTextRowProps = {
  /** Значение — крупно. */
  value: string;
  /** Подпись под ним — приглушённо: «О себе», «Имя пользователя». */
  caption: string;
  /** Скопировали — короткое подтверждение. */
  onCopied: () => void;
  testID?: string;
};

/** Строка карточки: значение и подпись. Долгое нажатие — «Копировать». */
export function InfoTextRow({ value, caption, onCopied, testID }: InfoTextRowProps) {
  const theme = useTheme();
  const rowRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const open = () => {
    rowRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };

  const copy = (_item: CopyItem) => {
    void Clipboard.setStringAsync(value).then(onCopied);
  };

  return (
    <>
      <Pressable
        ref={rowRef}
        testID={testID}
        accessibilityRole="text"
        accessibilityHint="Долгое нажатие — скопировать"
        onLongPress={open}
        style={({ pressed }) => [
          styles.row,
          (pressed || anchor) && { backgroundColor: theme.backgroundSelected },
        ]}
      >
        <Text variant="body">{value}</Text>
        <Text variant="small" color="textSecondary">
          {caption}
        </Text>
      </Pressable>
      <AnchoredMenu
        testID="info-copy-menu"
        anchor={anchor}
        actions={COPY_ACTIONS}
        onSelect={copy}
        onClosed={() => setAnchor(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: Radii.md,
    overflow: 'hidden',
    paddingVertical: Spacing.one,
  },
  row: {
    minHeight: InfoPageSizes.cardRowMinHeight,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
