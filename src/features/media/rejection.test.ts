import { VideoPrepareError } from './lib/compressVideo';
import { mediaRejectionText } from './rejection';
import { MediaUploadError } from './storage';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('react-native-compressor', () => ({ Video: { compress: jest.fn() } }));

describe('mediaRejectionText', () => {
  it('explains a video that could not be prepared', () => {
    expect(mediaRejectionText(new VideoPrepareError())).toMatch(/подготовить видео/);
  });

  it('explains a file that could not be cleaned of its metadata', () => {
    expect(mediaRejectionText(new MediaUploadError('x', null, 'unsupported'))).toMatch(
      /геометку и данные камеры/,
    );
  });

  it('explains a refusal of the database for an unsanitized file', () => {
    expect(mediaRejectionText({ code: 'OPN14', message: 'raw' })).toMatch(/не прошёл проверку/);
  });

  it('stays silent about anything else — no raw errors reach the screen', () => {
    expect(mediaRejectionText(new MediaUploadError('network'))).toBeNull();
    expect(mediaRejectionText({ code: '42501' })).toBeNull();
    expect(mediaRejectionText(new Error('boom'))).toBeNull();
  });
});
