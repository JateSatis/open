import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteMyAccount,
  endDeviceSession,
  endOtherSessions,
  linkIdentity,
  listIdentities,
  listMyDevices,
  unlinkIdentity,
  type IdentityProvider,
} from '@/api/account';

import { requestAppleIdToken, requestGoogleIdToken } from './signIn';
import { signOutQuietly } from './signOut';
import { describeAuthError, errorCodeOf } from './signInErrors';

export const accountKeys = {
  identities: ['account', 'identities'] as const,
  devices: ['account', 'devices'] as const,
};

export function useIdentities() {
  return useQuery({ queryKey: accountKeys.identities, queryFn: listIdentities });
}

export function useDevices() {
  return useQuery({ queryKey: accountKeys.devices, queryFn: listMyDevices });
}

export const PROVIDER_NAMES: Record<string, string> = { google: 'Google', apple: 'Apple' };

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

/** Ошибки привязки и отвязки человеческим текстом: сырые коды Auth наружу не идут. */
export function describeIdentityError(error: unknown, provider: string): string {
  switch (errorCodeOf(error)) {
    case 'identity_already_exists':
      return `Этот аккаунт ${providerName(provider)} уже связан с другим профилем Open.`;
    case 'manual_linking_disabled':
      return 'Привязка второго способа входа пока выключена на сервере.';
    case 'single_identity_not_deletable':
      return 'Это последний способ входа — его нельзя отвязать.';
    default:
      return describeAuthError(error);
  }
}

/** Отказ пользователя в нативном листе — не ошибка, показывать нечего. */
class LinkCancelled extends Error {}

export type LinkOutcome = 'linked' | 'cancelled';

export function useLinkProvider() {
  const queryClient = useQueryClient();

  return useMutation<LinkOutcome, Error, IdentityProvider>({
    mutationFn: async (provider) => {
      const result =
        provider === 'google' ? await requestGoogleIdToken() : await requestAppleIdToken();

      if (result.status === 'cancelled') throw new LinkCancelled();
      if (result.status === 'error') throw new Error(result.message);

      try {
        await linkIdentity(provider, result.token);
      } catch (error) {
        throw new Error(describeIdentityError(error, provider));
      }

      return 'linked';
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.identities });
      // Привязка выдаёт новый сеанс — устройство перерегистрируется, и список
      // должен это показать.
      void queryClient.invalidateQueries({ queryKey: accountKeys.devices });
    },
  });
}

export function isLinkCancelled(error: unknown): boolean {
  return error instanceof LinkCancelled;
}

export function useUnlinkIdentity() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { identityId: string; provider: string }>({
    mutationFn: async ({ identityId, provider }) => {
      try {
        await unlinkIdentity(identityId);
      } catch (error) {
        throw new Error(describeIdentityError(error, provider));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.identities }),
  });
}

export function useEndDeviceSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: endDeviceSession,
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.devices }),
  });
}

export function useEndOtherSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: endOtherSessions,
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.devices }),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      await deleteMyAccount();
      // Аккаунта на сервере больше нет вместе с сеансом — остаётся забыть
      // его и здесь. Кеш очистит AccountLifecycle.
      await signOutQuietly();
    },
  });
}
