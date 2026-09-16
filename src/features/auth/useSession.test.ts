import { useSession } from './useSession';

describe('useSession', () => {
  it('reports an unauthenticated session until real auth is wired up', () => {
    expect(useSession()).toEqual({ isAuthenticated: false });
  });
});
