import { initialSectionOf, sectionRequestOf, sectionRequestParams } from './sectionRequest';

describe('sectionRequestOf', () => {
  it('asks for «Посты» on a jump to a post, whatever the section says', () => {
    expect(
      sectionRequestOf({
        section: 'pops',
        sectionKey: '1',
        jumpTo: 'm',
        jumpAt: 't',
        jumpKey: '9',
      }),
    ).toEqual({ section: 'posts', key: '9' });
  });

  it('asks for «Посты» on a search over posts', () => {
    expect(sectionRequestOf({ search: '1', searchKey: '5' })).toEqual({
      section: 'posts',
      key: '5',
    });
  });

  it('asks for the named section by its key', () => {
    expect(sectionRequestOf({ section: 'pops', sectionKey: '3' })).toEqual({
      section: 'pops',
      key: '3',
    });
  });

  it('asks for nothing without a key: the section is only where to open', () => {
    expect(sectionRequestOf({ section: 'pops' })).toBeUndefined();
    expect(initialSectionOf({ section: 'pops' })).toBe('pops');
    expect(initialSectionOf({})).toBe('posts');
  });

  it('request params wipe the jump and search left from before', () => {
    const params = sectionRequestParams('pops');

    expect(sectionRequestOf(params)).toEqual({ section: 'pops', key: params.sectionKey });
  });
});
