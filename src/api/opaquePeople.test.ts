import { isOpaquePersonId, opaqueFlag } from './opaquePeople';

describe('opaque people', () => {
  it('запоминает только id, помеченные базой как непрозрачные', () => {
    expect(opaqueFlag('opaque-1', true)).toBe(true);
    expect(opaqueFlag('real-1', false)).toBe(false);
    expect(opaqueFlag(null, true)).toBe(true);

    expect(isOpaquePersonId('opaque-1')).toBe(true);
    expect(isOpaquePersonId('real-1')).toBe(false);
    expect(isOpaquePersonId(undefined)).toBe(false);
  });
});
