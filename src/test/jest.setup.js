/* global jest */
require('react-native-gesture-handler/jestSetup');

// В моке Reanimated `makeMutable` отдаёт само значение, а не объект с `.value`,
// как на устройстве, — модульные shared value в тестах иначе не работают.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  makeMutable: (value) => ({ value }),
}));

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});

jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);
