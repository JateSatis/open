import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';

import type { IdentityProvider } from '@/api/account';
import { Button } from '@/components/Button';
import { confirm } from '@/components/ConfirmDialog';
import { LinkButton } from '@/components/LinkButton';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { Text } from '@/components/Text';
import {
  isLinkCancelled,
  providerName,
  useIdentities,
  useLinkProvider,
  useUnlinkIdentity,
} from '@/features/auth/accountQueries';
import { useAppleSignInAvailable } from '@/features/auth/useAppleSignInAvailable';
import { describeLoadError } from '@/lib/network';

/**
 * Какими провайдерами можно войти в аккаунт. Отвязать можно любой, кроме
 * последнего. Apple на Android нативно недоступен — его привязка там не
 * предлагается вовсе.
 */
export function SignInMethods() {
  const { data: identities, isPending, error } = useIdentities();
  const link = useLinkProvider();
  const unlink = useUnlinkIdentity();
  const appleAvailable = useAppleSignInAvailable();

  const linked = new Set((identities ?? []).map((identity) => identity.provider));
  const linkable: IdentityProvider[] = [
    ...(linked.has('google') ? [] : (['google'] as const)),
    ...(linked.has('apple') || !appleAvailable ? [] : (['apple'] as const)),
  ];
  const canUnlink = (identities?.length ?? 0) > 1;

  const onUnlink = async (identityId: string, provider: string) => {
    const other = (identities ?? []).find((identity) => identity.id !== identityId);
    const agreed = await confirm({
      title: `Отвязать ${providerName(provider)}?`,
      message: `Войти в этот аккаунт через ${providerName(provider)} больше не получится.${
        other ? ` Останется вход через ${providerName(other.provider)}.` : ''
      }`,
      confirmLabel: 'Отвязать',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (agreed) unlink.mutate({ identityId, provider });
  };

  const linkError = link.error && !isLinkCancelled(link.error) ? link.error.message : null;
  const loadError = describeLoadError(error, 'Не удалось загрузить способы входа');
  const problem = linkError ?? unlink.error?.message ?? loadError;

  return (
    <SettingsSection
      title="Способы входа"
      footer="Почта приходит от провайдера и видна только вам."
    >
      {isPending ? (
        <ActivityIndicator accessibilityLabel="Загрузка способов входа" style={styles.loader} />
      ) : null}

      {(identities ?? []).map((identity, index) => (
        <SettingsRow
          key={identity.id}
          divided={index > 0}
          title={providerName(identity.provider)}
          subtitle={identity.email ?? 'Почта скрыта'}
          accessory={
            canUnlink ? (
              <LinkButton
                label="Отвязать"
                color="danger"
                accessibilityLabel={`Отвязать ${providerName(identity.provider)}`}
                loading={unlink.isPending && unlink.variables?.identityId === identity.id}
                onPress={() => void onUnlink(identity.id, identity.provider)}
              />
            ) : null
          }
        />
      ))}

      {linkable.length > 0 || problem ? (
        <View style={styles.footer}>
          {linkable.map((provider) => (
            <Button
              key={provider}
              label={`Привязать ${providerName(provider)}`}
              variant="secondary"
              loading={link.isPending && link.variables === provider}
              disabled={link.isPending}
              onPress={() => link.mutate(provider)}
              style={styles.linkButton}
            />
          ))}
          {problem ? (
            <Text variant="small" color="danger">
              {problem}
            </Text>
          ) : null}
        </View>
      ) : null}
    </SettingsSection>
  );
}
