import { Linking } from 'react-native';

export async function shareOnWhatsApp(message: string) {
  const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    throw new Error('No se pudo abrir WhatsApp.');
  }
  await Linking.openURL(url);
}
