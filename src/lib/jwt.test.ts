import { sessionIdOf } from './jwt';

function tokenWith(claims: object): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`;
}

describe('sessionIdOf', () => {
  it('reads the session id from an access token', () => {
    expect(sessionIdOf(tokenWith({ sub: 'u', session_id: 'session-1' }))).toBe('session-1');
  });

  it('survives base64url characters and missing padding', () => {
    const id = '1e7b6c7a-3f1d-4b8e-9d3f-2a6f0c1b5e9d';

    expect(sessionIdOf(tokenWith({ session_id: id, name: '???>>>' }))).toBe(id);
  });

  it('returns null for a token without a session id or garbage', () => {
    expect(sessionIdOf(tokenWith({ sub: 'u' }))).toBeNull();
    expect(sessionIdOf('not-a-token')).toBeNull();
    expect(sessionIdOf('a.%%%.c')).toBeNull();
  });
});
