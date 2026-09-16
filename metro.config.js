const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo Router scans every file under src/app via require.context — without
// this, *.test.tsx files get bundled into the native app too, and pull in
// @testing-library/react-native, which imports Node's `console` module and
// crashes the bundle at runtime.
config.resolver.blockList = /\.test\.[jt]sx?$|\.spec\.[jt]sx?$/;

module.exports = config;
