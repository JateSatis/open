const {
  AndroidConfig,
  withAndroidStyles,
  withDangerousMod,
  withMod,
} = require('expo/config-plugins');
const { cp } = require('node:fs/promises');
const path = require('node:path');

// Register before expo-splash-screen so these mods see its generated theme and storyboard.
module.exports = function withNativeSplash(config) {
  config = withMod(config, {
    platform: 'ios',
    mod: 'splashScreenStoryboard',
    action(mod) {
      // SDK 57 removes the image view but leaves its constraints and resource behind.
      const { scenes, resources } = mod.modResults.document;
      const view = scenes[0].scene[0].objects[0].viewController[0].view[0];
      view.constraints = [{}];
      delete resources[0].image;
      view.color = [{ $: { key: 'backgroundColor', name: 'SplashScreenBackground' } }];
      resources[0].namedColor = [
        {
          $: { name: 'SplashScreenBackground' },
          color: [
            {
              $: {
                white: '1',
                alpha: '1',
                colorSpace: 'custom',
                customColorSpace: 'genericGamma22GrayColorSpace',
              },
            },
          ],
        },
      ];
      return mod;
    },
  });

  config = withAndroidStyles(config, (mod) => {
    // Android 12/12L read the duration from the theme. Newer versions read the AVD.
    AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: { name: 'Theme.App.SplashScreen', parent: 'Theme.SplashScreen' },
      name: 'windowSplashScreenAnimationDuration',
      value: '@integer/open_splash_duration',
    });
    return mod;
  });

  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const res = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
      const source = path.join(mod.modRequest.projectRoot, 'plugins/splash-res');
      await cp(source, res, { recursive: true });
      return mod;
    },
  ]);
};
