import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.devil.app147',
  appName: '147',
  webDir: 'dist',
  android: {
    backgroundColor: '#0e1015',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#7c9cff',
    },
  },
};

export default config;
