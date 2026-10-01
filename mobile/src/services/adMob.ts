import mobileAds, {
  AdEventType,
  InterstitialAd,
  TestIds,
} from 'react-native-google-mobile-ads';

// En desarrollo SIEMPRE usamos el ID oficial de prueba de Google.
const INTERSTITIAL_UNIT_ID = __DEV__
  ? TestIds.INTERSTITIAL
  : 'ca-app-pub-5707119033456291/5074011042';

// Estrategia poco invasiva para Cuánto Pago.
const MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos
const MAX_ADS_PER_SESSION = 3;

const interstitial = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
  requestNonPersonalizedAdsOnly: false,
});

let initialized = false;
let loaded = false;
let loading = false;
let adsShownThisSession = 0;
let lastShownAt = 0;
let listenersAttached = false;

function loadInterstitial() {
  if (!initialized || loading || loaded) return;
  loading = true;
  interstitial.load();
}

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  interstitial.addAdEventListener(AdEventType.LOADED, () => {
    loaded = true;
    loading = false;
  });

  interstitial.addAdEventListener(AdEventType.CLOSED, () => {
    loaded = false;
    loading = false;
    // Dejamos preparado el próximo anuncio en segundo plano.
    loadInterstitial();
  });

  interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
    loaded = false;
    loading = false;
    console.warn('[Cuánto Pago] AdMob interstitial:', error);
  });
}

export async function initializeAdMob() {
  if (initialized) return;

  try {
    attachListeners();
    await mobileAds().initialize();
    initialized = true;
    loadInterstitial();
  } catch (error) {
    // Los anuncios nunca deben impedir usar la app.
    console.warn('[Cuánto Pago] No se pudo inicializar AdMob:', error);
  }
}

/**
 * Muestra un anuncio solo si ya está cargado y se cumplen nuestros límites.
 * Si no hay anuncio disponible, devuelve false inmediatamente y la app sigue.
 */
export async function showInterstitialIfEligible(): Promise<boolean> {
  if (!initialized) {
    void initializeAdMob();
    return false;
  }

  const now = Date.now();
  const cooldownComplete =
    lastShownAt === 0 || now - lastShownAt >= MIN_INTERVAL_MS;

  if (
    !loaded ||
    !cooldownComplete ||
    adsShownThisSession >= MAX_ADS_PER_SESSION
  ) {
    loadInterstitial();
    return false;
  }

  try {
    // Marcamos el consumo antes de mostrar para evitar dobles taps.
    loaded = false;
    adsShownThisSession += 1;
    lastShownAt = now;
    await interstitial.show();
    return true;
  } catch (error) {
    console.warn('[Cuánto Pago] No se pudo mostrar el anuncio:', error);
    loadInterstitial();
    return false;
  }
}
