import { View } from 'react-native';

import { styles } from './styles';

import type { ReportReason } from '@/api/blocks';
import { SettingsRow } from '@/components/SettingsRow';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'spam', label: 'Спам' },
  { id: 'harassment', label: 'Домогательства' },
  { id: 'threats', label: 'Угрозы' },
  { id: 'other', label: 'Другое' },
];

/** Причина жалобы — одна из четырёх, выбранная отмечена. */
export function ReasonList({
  value,
  onChange,
}: {
  value: ReportReason | null;
  onChange: (reason: ReportReason) => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.group, { borderColor: theme.border }]}>
      {REASONS.map((item, index) => (
        <SettingsRow
          key={item.id}
          testID={`report-reason-${item.id}`}
          title={item.label}
          divided={index > 0}
          accessibilityLabel={`${item.label}${value === item.id ? ', выбрано' : ''}`}
          accessory={value === item.id ? <Text color="primary">✓</Text> : null}
          onPress={() => onChange(item.id)}
        />
      ))}
    </View>
  );
}
