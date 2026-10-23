import { SymbolView } from 'expo-symbols';

import type { PublicDelay } from '@/api/privacy';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

const TITLE = 'Задержка публикации для зрителей';

const OPTIONS: readonly { value: PublicDelay; label: string }[] = [
  { value: 'off', label: 'Выкл' },
  { value: 'random_delay', label: 'Случайная, 1–30 минут' },
];

export type DelayChoiceProps = {
  value: PublicDelay;
  onChange: (value: PublicDelay) => void;
};

/**
 * «Задержка публикации для зрителей»: участники видят сразу, остальные —
 * позже. Задерживается и то, что в чате написали после меня, иначе ответы
 * выдавали бы и само сообщение, и его время.
 */
export function DelayChoice({ value, onChange }: DelayChoiceProps) {
  const theme = useTheme();

  return (
    <SettingsSection
      title={TITLE}
      footer="Участники чата видят ваши сообщения сразу, остальные — позже. Задерживается и то, что написано в чате после вас."
    >
      {OPTIONS.map((option, index) => (
        <SettingsRow
          key={option.value}
          testID={`privacy-delay-${option.value}`}
          divided={index > 0}
          title={option.label}
          accessibilityLabel={`${TITLE}: ${option.label}${option.value === value ? ', выбрано' : ''}`}
          onPress={() => {
            if (option.value !== value) onChange(option.value);
          }}
          accessory={
            option.value === value ? (
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
