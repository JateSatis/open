import type { ChannelSection } from '@/features/channels/useMarkChannelSectionRead';
import type { ChatSearchParams } from '@/features/chats/chatSearch/useChatSearch';
import { jumpRequestOf, JUMP_PARAM_NAMES, type JumpParams } from '@/features/chats/jumpParams';

/**
 * Запрос раздела снаружи: какой раздел показать и ключ запроса. Новый ключ
 * переключает экран канала — и уже открытый, ниже в стеке; прежний ключ,
 * оставшийся в адресе, раздел, выбранный после, не трогает.
 */
export type SectionRequest = { section: ChannelSection; key: string };

/** Параметры адреса канала, которыми раздел просят открыть. */
export type SectionParams = { section?: string; sectionKey?: string };

export type ChannelRouteParams = SectionParams & JumpParams & ChatSearchParams;

function sectionOf(value: string | undefined): ChannelSection {
  return value === 'pops' ? 'pops' : 'posts';
}

/**
 * Запрос раздела по адресу канала. Прыжок к посту и поиск по постам — это
 * запрос «Постов»: сами прыжок, шит и поиск исполняют «Посты» по тем же
 * параметрам. Иначе — раздел из `section` с ключом `sectionKey`.
 */
export function sectionRequestOf(params: ChannelRouteParams): SectionRequest | undefined {
  const posts = jumpRequestOf(params) ?? (params.search === '1' ? params.searchKey : undefined);

  if (posts) return { section: 'posts', key: posts };
  if (params.sectionKey) return { section: sectionOf(params.section), key: params.sectionKey };

  return undefined;
}

/** Раздел, с которого открыть экран без запроса. */
export function initialSectionOf(params: ChannelRouteParams): ChannelSection {
  return sectionOf(params.section);
}

/**
 * Параметры, которыми уже открытый экран канала просят показать раздел.
 * Прыжок и поиск прошлого перехода стираются: иначе запрос «Постов» по ним
 * перебил бы новый.
 */
export function sectionRequestParams(section: ChannelSection): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(JUMP_PARAM_NAMES.map((name) => [name, undefined])),
    search: undefined,
    searchKey: undefined,
    section,
    sectionKey: String(Date.now()),
  };
}
