/* global jest */
require('react-native-gesture-handler/jestSetup');

// В моке Reanimated `makeMutable` отдаёт само значение, а не объект с `.value`,
// как на устройстве, — модульные shared value в тестах иначе не работают.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  makeMutable: (value) => ({ value }),
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
