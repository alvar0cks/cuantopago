import { Platform } from 'react-native';

// IMPORTANTE:
// No importamos react-native-google-mobile-ads de forma estática.
// Expo Go no incluye ese módulo nativo y un import normal hace que la app
// falle antes de poder desactivar la publicidad.

const MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ADS_PER_SESSION = 3;

let adsModule: any = null;
let interstitial: any = null;
let initialized = false;
let loaded = false;
let loading = false;
let adsShownThisSession = 0;
let lastShownAt = 0;
let listenersAttached = false;
let adsUnavailable = false;

function isExpoGo(): boolean {
  try {
    // expo-constants viene incluido con Expo. Lo cargamos dinámicamente para
    // mantener este archivo seguro también en builds nativos.
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
  } catch (error) {
    adsUnavailable = true;
    if (__DEV__) {
      console.log('[Cuánto Pago] AdMob desactivado en este entorno.');
    }
    return null;
  }
}

function getInterstitial(): any | null {
  if (interstitial) return interstitial;

  const ads = getAdsModule();
  if (!ads) return null;

  const unitId = __DEV__
    ? ads.TestIds.INTERSTITIAL
    : Platform.select({
        ios: 'ca-app-pub-5707119033456291/9251443056',
        android: 'ca-app-pub-5707119033456291/5074011042',
        default: ads.TestIds.INTERSTITIAL,
      });

  interstitial = ads.InterstitialAd.createForAdRequest(unitId, {
    requestNonPersonalizedAdsOnly: false,
  });

  return interstitial;
}

function loadInterstitial(): void {
  const ad = getInterstitial();
  if (!ad || !initialized || loading || loaded) return;

  loading = true;
  try {
    ad.load();
  } catch (error) {
    loading = false;
    console.warn('[Cuánto Pago] No se pudo cargar AdMob:', error);
  }
}

function attachListeners(): void {
  if (listenersAttached) return;

  const ads = getAdsModule();
  const ad = getInterstitial();
  if (!ads || !ad) return;

  listenersAttached = true;

  ad.addAdEventListener(ads.AdEventType.LOADED, () => {
    loaded = true;
    loading = false;
  });

  ad.addAdEventListener(ads.AdEventType.CLOSED, () => {
    loaded = false;
    loading = false;
    loadInterstitial();
  });

  ad.addAdEventListener(ads.AdEventType.ERROR, (error: unknown) => {
    loaded = false;
    loading = false;
    console.warn('[Cuánto Pago] AdMob interstitial:', error);
  });
}

export async function initializeAdMob(): Promise<void> {
  // Expo Go: no hacemos absolutamente nada. La app sigue funcionando normal.
  if (isExpoGo()) return;
  if (initialized) return;

  const ads = getAdsModule();
  if (!ads) return;

  try {
    const ad = getInterstitial();
    if (!ad) return;

    attachListeners();
    await ads.default().initialize();
    initialized = true;
    loadInterstitial();
  } catch (error) {
    console.warn('[Cuánto Pago] No se pudo inicializar AdMob:', error);
  }
}

/**
 * Publicidad ligada a acciones de valor.
 *
 * Expo Go -> devuelve false inmediatamente.
 * Build nativo -> muestra el anuncio solo si está listo y corresponde.
 * Sin anuncio -> la acción del usuario continúa normalmente.
 */

/*
export async function showInterstitialIfEligible(): Promise<boolean> {
  if (isExpoGo()) return false;

  const ad = getInterstitial();
  const ads = getAdsModule();
  if (!ad || !ads) return false;

  if (!initialized) {
    void initializeAdMob();
    return false;
  }

  const now = Date.now();

  if (
    !loaded ||
    adsShownThisSession >= MAX_ADS_PER_SESSION ||
    (lastShownAt !== 0 && now - lastShownAt < MIN_INTERVAL_MS)
  ) {
    loadInterstitial();
    return false;
  }

  loaded = false;
  adsShownThisSession += 1;
  lastShownAt = now;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unsubscribeClosed: (() => void) | undefined;
    let unsubscribeError: (() => void) | undefined;

    const finish = (shown: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribeClosed?.();
      unsubscribeError?.();
      resolve(shown);
    };

    unsubscribeClosed = ad.addAdEventListener(
      ads.AdEventType.CLOSED,
      () => finish(true)
    );

    unsubscribeError = ad.addAdEventListener(
      ads.AdEventType.ERROR,
      () => finish(false)
    );

    ad.show().catch((error: unknown) => {
      console.warn('[Cuánto Pago] No se pudo mostrar el anuncio:', error);
      finish(false);
      loadInterstitial();
    });
  });
}
