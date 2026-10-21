/* global jest */
require('react-native-gesture-handler/jestSetup');

// В моке Reanimated `makeMutable` отдаёт само значение, а не объект с `.value`,
// как на устройстве, — модульные shared value в тестах иначе не работают.
// `useAnimatedRef` на устройстве — функция-ссылка с `observe`; в моке —
// голый объект, и скролл шита на нём не подключился бы.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  makeMutable: (value) => ({ value }),
  // На устройстве shared value живёт весь срок компонента; в моке — новый на
  // каждый рендер, и записанное в него до перерисовки терялось.
  useSharedValue: (init) => {
    const holder = require('react').useRef(null);

    if (!holder.current) holder.current = require('react-native-reanimated/mock').useSharedValue(init);

    return holder.current;
  },
  // Анимаций раскладки в моке нет — и настройке их пропуска нечего делать.
  LayoutAnimationConfig: ({ children }) => children,
  useAnimatedRef: () => {
    const holder = require('react').useRef(null);

    if (!holder.current) {
      const ref = (instance) => {
        ref.current = instance;
      };

      ref.current = null;
      ref.observe = () => () => undefined;
      holder.current = ref;
    }

    return holder.current;
  },
}));

// Замер в окне у мока `View` — пустышка без колбэка, и меню строки, которое
// открывается по замеру, в тестах не открылось бы. Отвечает нулевой рамкой.
require('@react-native/jest-preset/jest/MockNativeMethods').default.measureInWindow = (callback) =>
  callback(0, 0, 0, 0);

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});

jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

// Топики комментариев — Realtime: в тестах сети нет. Экраны чата слушают
// ветки пересланных комментариев, панель — свою ветку; подписка — пустышка.
jest.mock('@/api/commentTopics', () => ({
  acquireCommentTopic: jest.fn(() => () => undefined),
}));

// Подписки на каналы и чужие чаты — запросы к базе. По умолчанию я ни на что не подписан;
// тест подписок подменяет функции сам (`jest.mocked(getMySubscription)`).
jest.mock('@/api/subscriptions', () => ({
  SUBSCRIBERS_PAGE_SIZE: 30,
  getMySubscription: jest.fn(() => Promise.resolve(null)),
  listChatSubscriptions: jest.fn(() => Promise.resolve([])),
  subscribeToChannel: jest.fn(() => Promise.resolve()),
  setChannelInChats: jest.fn(() => Promise.resolve()),
  setChannelNotifications: jest.fn(() => Promise.resolve()),
  unsubscribeFromChannel: jest.fn(() => Promise.resolve()),
  markChannelRead: jest.fn(() => Promise.resolve()),
  listChannelSubscribers: jest.fn(() => Promise.resolve([])),
  getMyChatSubscription: jest.fn(() => Promise.resolve(null)),
  subscribeToChat: jest.fn(() => Promise.resolve()),
  setChatNotifications: jest.fn(() => Promise.resolve()),
  unsubscribeFromChat: jest.fn(() => Promise.resolve()),
  markChatSubscriptionRead: jest.fn(() => Promise.resolve()),
  listChatSubscribers: jest.fn(() => Promise.resolve([])),
}));

// LiveKit — нативный WebRTC: в тестах его нет и быть не должно. Звонок
// проверяется через состояние (`callStore`) и замоканный `callSession`.
jest.mock('@livekit/react-native', () => ({
  registerGlobals: jest.fn(),
  AudioSession: {
    configureAudio: jest.fn(() => Promise.resolve()),
    startAudioSession: jest.fn(() => Promise.resolve()),
    stopAudioSession: jest.fn(() => Promise.resolve()),
    selectAudioOutput: jest.fn(() => Promise.resolve()),
    getAudioOutputs: jest.fn(() => Promise.resolve(['speaker', 'earpiece'])),
  },
  AndroidAudioTypePresets: { communication: {}, media: {} },
}));

jest.mock('livekit-client', () => {
  const { EventEmitter } = require('events');

  class Room extends EventEmitter {
    static instances = [];

    constructor() {
      super();
      Room.instances.push(this);
      this.remoteParticipants = new Map();
      this.localParticipant = {
        identity: 'me',
        name: 'Я',
        metadata: undefined,
        isSpeaking: false,
        isMicrophoneEnabled: false,
        setMicrophoneEnabled: jest.fn(function (enabled) {
          this.isMicrophoneEnabled = enabled;
          return Promise.resolve();
        }),
      };
      this.connect = jest.fn(() => Promise.resolve());
      this.disconnect = jest.fn(() => Promise.resolve());
    }
  }

  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_target, key) => String(key) }),
    DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, ROOM_DELETED: 5 },
  };
});

// AsyncStorage — нативный модуль; в тестах — хранилище в памяти из пакета.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Фрагменты текста — сеть. Экраны переписки и комментариев их подгружают;
// тест фрагментов подменяет функции сам (`jest.mocked(listMessageFragments)`).
jest.mock('@/api/fragments', () => ({
  listMessageFragments: jest.fn(() => Promise.resolve([])),
  setFragmentReaction: jest.fn(() => Promise.resolve({ fragmentId: null, mine: null })),
}));

// Кластеры фрагментов и события для их модели — сеть. Облачко в режиме
// фрагментов их подгружает и пишет; тесты кластеров подменяют функции сами,
// а тесты самих модулей снимают подмену (`jest.unmock`).
jest.mock('@/api/fragmentClusters', () => ({
  listMessageClusters: jest.fn(() => Promise.resolve([])),
  getAreaSummary: jest.fn(() =>
    Promise.resolve({
      fragmentIds: [],
      memberReactions: {},
      visitorReactions: {},
      reactionsCount: 0,
      commentsCount: 0,
      myClusterId: null,
      mine: null,
      myFragmentId: null,
    }),
  ),
}));

jest.mock('@/api/fragmentClusterEvents', () => ({
  trackClusterEvent: jest.fn(),
  flushClusterEvents: jest.fn(() => Promise.resolve()),
}));

// Skia в jest не грузится (ESM и нативный модуль), а подсветка кластеров —
// в дереве любого облачка. Холст в тестах пустой; файлы, которым нужно
// больше, мокают Skia сами.
jest.mock('@shopify/react-native-skia', () => ({
  Canvas: () => null,
  Path: () => null,
  ImageShader: () => null,
  BlendColor: () => null,
  TextAlign: { Center: 2 },
  Skia: { Path: { Make: () => ({}) }, Surface: { Make: () => null } },
}));

// Нативный выбор даты из @expo/ui. В тестах — кнопка «выбрать», которая
// отдаёт день из `globalThis.mockPickerDate` (или текущее значение), и
// кнопка «закрыть» — как отмена диалога Android.
jest.mock('@expo/ui/community/datetime-picker', () => {
  const { Pressable, Text, View } = require('react-native');

  const { createElement: h } = require('react');

  function DateTimePicker(props) {
    const picked = globalThis.mockPickerDate ?? props.value;

    return h(
      View,
      { testID: props.testID },
      h(
        Pressable,
        {
          testID: `${props.testID}-pick`,
          onPress: () => props.onValueChange?.({ nativeEvent: {} }, picked),
        },
        h(Text, null, 'выбрать'),
      ),
      h(
        Pressable,
        { testID: `${props.testID}-dismiss`, onPress: () => props.onDismiss?.() },
        h(Text, null, 'закрыть'),
      ),
    );
  }

  return { DateTimePicker, default: DateTimePicker };
});
