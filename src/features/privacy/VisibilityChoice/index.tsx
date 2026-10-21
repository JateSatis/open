import { SymbolView } from 'expo-symbols';

import type { Visibility } from '@/api/privacy';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { VISIBILITY_LABELS, VISIBILITY_OPTIONS } from '@/features/privacy/visibility';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type VisibilityChoiceProps = {
  /** Заголовок группы — вопрос: «Кто видит список друзей». */
  title: string;
  /** Что именно скрывается — под вариантами. */
  footer: string;
  value: Visibility;
  onChange: (value: Visibility) => void;
  testID: string;
};

/** Настройка видимости с тремя состояниями: всем, только друзьям, никому. */
export function VisibilityChoice({ title, footer, value, onChange, testID }: VisibilityChoiceProps) {
  const theme = useTheme();

  return (
    <SettingsSection title={title} footer={footer}>
      {VISIBILITY_OPTIONS.map((option, index) => (
        <SettingsRow
          key={option}
          testID={`${testID}-${option}`}
          divided={index > 0}
          title={VISIBILITY_LABELS[option]}
          accessibilityLabel={`${title}: ${VISIBILITY_LABELS[option]}${option === value ? ', выбрано' : ''}`}
          onPress={() => {
            if (option !== value) onChange(option);
          }}
          accessory={
            option === value ? (
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={Sizes.menuIcon}
                tintColor={theme.primary}
              />
            ) : null
          }
        />
      ))}
    </SettingsSection>
  );
}
