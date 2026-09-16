export type Session = {
  isAuthenticated: boolean;
};

/**
 * Placeholder until the real Supabase session lands in this feature module.
 * Routing already depends on it so the (auth)/(tabs) redirect has one place
 * to read from instead of being rewired when auth ships.
 */
export function useSession(): Session {
  return { isAuthenticated: false };
}
