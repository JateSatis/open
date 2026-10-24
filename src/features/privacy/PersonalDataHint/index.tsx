import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import type { HiddenRange } from '@/features/chats/hiddenText';
import { PERSONAL_DATA_LABELS, scanPersonalData } from '@/features/privacy/personalData';
import { Spacing } from '@/theme';

/** Пауза в наборе, после которой текст проверяется: подсказка не мигает на каждой букве. */
const SCAN_DELAY_MS = 400;

export type PersonalDataHintProps = {
  text: string;
  /** Кто увидит — продолжение строки: «увидят все, кто откроет чат». */
  audience?: string;
  /** Уже скрытое от зрителей: о нём строка не говорит. */
  hidden?: readonly HiddenRange[];
};

/**
 * Тихая строка над полем ввода, когда в тексте похоже на личные данные.
 * Отправку не блокирует: при высоком риске перед отправкой спросит лист.
 */
export function PersonalDataHint({
  text,
  audience = 'увидят все, кто откроет чат',
  hidden,
}: PersonalDataHintProps) {
  // Текст и скрытое — одной парой после паузы: скрытое сдвигается вместе с
  // текстом сразу, и старый текст со свежими диапазонами не совпал бы по
  // позициям. Пустое поле — сразу.
  const [settled, setSettled] = useState({ text, hidden });

  useEffect(() => {
    const timer = setTimeout(() => setSettled({ text, hidden }), text === '' ? 0 : SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, hidden]);

  const scan = useMemo(
    () => scanPersonalData(settled.text, settled.hidden),
    [settled],
  );

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
