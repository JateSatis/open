import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import type { UsernameAvailability } from '@/features/channels/useUsernameAvailability';
import { USERNAME_MAX_LENGTH } from '@/features/profile/username';

export type UsernameFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  availability: UsernameAvailability;
  onFocus?: () => void;
};

/** Поле `@имени` с ответом на лету: проверяем, свободно, занято, неверный формат. */
export function UsernameField({ value, onChangeText, availability, onFocus }: UsernameFieldProps) {
  const error =
    availability.status === 'invalid'
      ? availability.message
      : availability.status === 'taken'
        ? 'Это имя уже занято'
        : undefined;

  return (
    <>
      <Input
        testID="channel-username"
        label="Username"
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        error={error}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={USERNAME_MAX_LENGTH}
        placeholder="username"
      />

      {availability.status === 'checking' ? (
        <Text testID="username-status" variant="small" color="textSecondary">
          Проверяем…
        </Text>
      ) : availability.status === 'available' ? (
        <Text testID="username-status" variant="small" color="success">
          Имя свободно
        </Text>
      ) : availability.status === 'failed' ? (
        <Text testID="username-status" variant="small" color="textSecondary">
          Не удалось проверить имя
        </Text>
      ) : null}
    </>
  );
}
