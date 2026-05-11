import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.slr.otg',
  appName: 'SLR OTG',
  webDir: 'public',
  server: {
    url: 'https://comf-otg.comfyui-otg.win',
    cleartext: false
  }
};

export default config;
