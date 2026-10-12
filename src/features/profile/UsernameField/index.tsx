import type { UsernameKind } from '@/api/usernames';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import type { UsernameAvailability } from '@/features/profile/useUsernameAvailability';
import {
  normalizeUsernameInput,
  USERNAME_MAX_LENGTH,
  USERNAME_SUFFIX,
} from '@/features/profile/username';

export type UsernameFieldProps = {
  /** Чьё имя: от вида зависят приставка справа и пространство проверки. */
  kind: UsernameKind;
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  availability: UsernameAvailability;
  /** Ошибка с сервера после сохранения — поверх ответа на лету. */
  error?: string | null;
  onFocus?: () => void;
  testID?: string;
};

/**
 * Поле `@имени` с ответом на лету: проверяем, свободно, занято, неверный
 * формат. Суффикс вида (`.ch`, `.di`) стоит справа приставкой и не вводится;
 * вставленный вместе с именем — молча срезается.
 */
export function UsernameField({
  kind,
  label = 'Username',
  value,
  onChangeText,
  availability,
  error,
  onFocus,
  testID = 'username-field',
}: UsernameFieldProps) {
  const shownError =
    error ??
    (availability.status === 'invalid'
      ? availability.message
      : availability.status === 'taken'
        ? 'Имя занято'
        : undefined);

  return (
    <>
      <Input
        testID={testID}
        label={label}
        value={value}
        onChangeText={(text) => onChangeText(normalizeUsernameInput(text, kind))}
        onFocus={onFocus}
        error={shownError ?? undefined}
        suffix={USERNAME_SUFFIX[kind] || undefined}
        autoCapitalize="none"
        autoCorrect={false}
        // Запас под вставку с суффиксом: `news.ch` должно влезть, чтобы срезаться.
        maxLength={USERNAME_MAX_LENGTH + USERNAME_SUFFIX[kind].length}
        placeholder="username"
      />

      {shownError ? null : availability.status === 'checking' ? (
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
