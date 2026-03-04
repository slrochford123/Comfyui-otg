import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.slr.otg',
  appName: 'SLR OTG',
  webDir: '.next',
  server: {
    url: 'http://100.76.179.83:3001',
    cleartext: true
  }
};

export default config;
