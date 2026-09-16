import { useSession } from '@/features/auth/useSession';

/**
 * The signed-in user's id, read from the single auth provider — the messenger
 * never asks `supabase.auth` on its own.
 */
export function useCurrentUserId(): string | null {
  const { session } = useSession();

  return session?.user.id ?? null;
}
