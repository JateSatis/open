import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useDebounced } from '@/lib/useDebounced';
import { PERSONAL_DATA_LABELS, scanPersonalData } from '@/features/privacy/personalData';
import { Spacing } from '@/theme';

/** Пауза в наборе, после которой текст проверяется: подсказка не мигает на каждой букве. */
const SCAN_DELAY_MS = 400;

export type PersonalDataHintProps = {
  text: string;
  /** Кто увидит — продолжение строки: «увидят все, кто откроет чат». */
  audience?: string;
};

/**
 * Тихая строка над полем ввода, когда в тексте похоже на личные данные.
 * Отправку не блокирует: при высоком риске перед отправкой спросит лист.
 */
export function PersonalDataHint({
  text,
  audience = 'увидят все, кто откроет чат',
}: PersonalDataHintProps) {
  const settled = useDebounced(text, SCAN_DELAY_MS);
  const scan = useMemo(() => scanPersonalData(settled), [settled]);

  if (scan.risk === 'none' || !text.trim()) return null;

  const kinds = [...new Set(scan.findings.map((finding) => PERSONAL_DATA_LABELS[finding.kind]))];

  return (
    <View testID="personal-data-hint" style={styles.hint}>
      <Text variant="small" color="textSecondary">
        {kinds.join(', ')} — это {audience}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
});
