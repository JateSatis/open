import type { LocalMedia, OutgoingMedia, OutgoingPreview } from '@/features/media';

type MockedMedia = {
  assetPreviewUri: (asset: OutgoingMedia) => string;
  resolveLibraryAsset: (asset: OutgoingMedia) => Promise<OutgoingMedia & { uri: string }>;
  libraryAssetToLocalMedia: (asset: OutgoingMedia & { uri: string }) => LocalMedia;
};

/**
 * «Итоговый файл выбранного» поверх моков `@/features/media` в тестах экранов
 * и отправки: превью и байты идут через замоканные `assetPreviewUri` и
 * `resolveLibraryAsset`, как до правок фото. Вставляется в фабрику мока:
 * `...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock`.
 */
export const outgoingMediaMock = {
  outgoingPreview: (asset: OutgoingMedia): OutgoingPreview => {
    const media = jest.requireMock<MockedMedia>('@/features/media');

    return { url: media.assetPreviewUri(asset), width: asset.width, height: asset.height };
  },
  outgoingLocalMedia: async (asset: OutgoingMedia): Promise<LocalMedia> => {
    const media = jest.requireMock<MockedMedia>('@/features/media');

    return media.libraryAssetToLocalMedia(await media.resolveLibraryAsset(asset));
  },
};
