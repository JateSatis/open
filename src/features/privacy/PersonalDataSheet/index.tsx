import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { PERSONAL_DATA_LABELS, type PersonalDataFinding } from '@/features/privacy/personalData';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type PersonalDataSheetProps = {
  visible: boolean;
  findings: PersonalDataFinding[];
  /** Кто увидит: «Это сообщение увидят все, кто откроет чат». */
  audience: string;
  /** Скрыть найденное от зрителей — только там, где есть скрытый текст. */
  onHide?: () => void;
  onSendAsIs: () => void;
  /** Подпись «как есть»: «Отправить как есть», в профиле — «Сохранить как есть». */
  sendAsIsLabel?: string;
  /** «Изменить»: лист закрывается, текст остаётся в поле. */
  onEdit: () => void;
};

/**
 * Лист перед публикацией текста, похожего на личные данные. Ничего не
 * запрещает и ничего не обещает: показывает, что нашлось, и даёт выбрать —
 * поправить, скрыть найденное от зрителей или отправить как есть.
 */
export function PersonalDataSheet({
  visible,
  findings,
  audience,
  onHide,
  onSendAsIs,
  sendAsIsLabel = 'Отправить как есть',
  onEdit,
}: PersonalDataSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onEdit}>
      <Pressable
        testID="personal-data-backdrop"
        style={[
          styles.backdrop,
          { backgroundColor: theme.overlay, paddingBottom: Math.max(insets.bottom, Spacing.three) },
        ]}
        onPress={onEdit}
      >
        {/* Тап по самому листу не закрывает его как тап мимо. */}
        <Pressable
          testID="personal-data-sheet"
          onPress={() => {}}
          style={[styles.sheet, { backgroundColor: theme.background }]}
        >
          <Text variant="subtitle">Это увидят все</Text>
          <Text color="textSecondary">{audience} Похоже, здесь есть личные данные:</Text>

          <View style={styles.findings}>
            {findings.map((finding) => (
              <View key={`${finding.start}-${finding.end}`} style={styles.finding}>
                <Text variant="smallBold">{PERSONAL_DATA_LABELS[finding.kind]}</Text>
                <Text
                  variant="small"
                  color="textSecondary"
                  style={styles.findingText}
                  numberOfLines={2}
                >
                  {finding.text}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.actions}>
            {onHide ? <Button label="Скрыть найденное от зрителей" onPress={onHide} /> : null}
            <Button label={sendAsIsLabel} variant="secondary" onPress={onSendAsIs} />
            <Button label="Изменить" variant="ghost" onPress={onEdit} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
