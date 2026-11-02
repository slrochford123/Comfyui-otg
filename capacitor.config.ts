import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.slr.otg',
  appName: 'SLR Studios',
  webDir: 'android-web',
  android: {
    adjustMarginsForEdgeToEdge: 'auto'
  },
  server: {
    url: 'https://comf-otg.comfyui-otg.win',
    cleartext: false
  }
};

export default config;
