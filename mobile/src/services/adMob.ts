let adsModule: any = null;
let initialized = false;
let adsUnavailable = false;

function isExpoGo(): boolean {
  try {
    const Constants = require('expo-constants').default;
    return (
      Constants?.executionEnvironment === 'storeClient' ||
      Constants?.appOwnership === 'expo'
    );
  } catch {
    return false;
  }
}

function getAdsModule(): any | null {
  if (adsUnavailable || isExpoGo()) return null;
  if (adsModule) return adsModule;

  try {
    adsModule = require('react-native-google-mobile-ads');
    return adsModule;
  } catch {
    adsUnavailable = true;
    if (__DEV__) {
      console.log('[Cuánto Pago] AdMob desactivado en este entorno.');
    }
    return null;
  }
}

export async function initializeAdMob(): Promise<void> {
  if (isExpoGo() || initialized) return;

  const ads = getAdsModule();
  if (!ads) return;

  try {
    await ads.default().initialize();
    initialized = true;
  } catch (error) {
    console.warn('[Cuánto Pago] No se pudo inicializar AdMob:', error);
  }
}
