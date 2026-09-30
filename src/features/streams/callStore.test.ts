import { toRoster, type RoomMember } from '@/features/streams/callStore';

function member(
  identity: string,
  role: string | null,
  overrides: Partial<RoomMember> = {},
): RoomMember {
  return {
    identity,
    name: identity,
    metadata: role ? JSON.stringify({ role }) : undefined,
    isLocal: false,
    isSpeaking: false,
    isMicrophoneEnabled: true,
    ...overrides,
  };
}

it('говорящие — только host и speaker, слушатели считаются числом', () => {
  const roster = toRoster([
    member('Пётр', 'speaker'),
    member('Анна', 'host'),
    member('гость-1', 'listener'),
    member('гость-2', 'listener'),
  ]);

  expect(roster.speakers.map((speaker) => speaker.id)).toEqual(['Анна', 'Пётр']);
  expect(roster.listeners).toBe(2);
});

it('без роли в токене — не говорящий: подписанную сервером роль не подделать', () => {
  const roster = toRoster([
    member('чужой', null),
    member('битый', null, { metadata: '{not json' }),
  ]);

  expect(roster.speakers).toEqual([]);
});

it('с выключенным микрофоном человек не «говорит», даже если LiveKit так считает', () => {
  const [speaker] = toRoster([
    member('Анна', 'host', { isSpeaking: true, isMicrophoneEnabled: false }),
  ]).speakers;

  expect(speaker.speaking).toBe(false);
  expect(speaker.micOn).toBe(false);
});
