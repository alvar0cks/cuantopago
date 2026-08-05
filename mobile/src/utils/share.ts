import { Linking, Share } from 'react-native';

export async function shareOnWhatsApp(message: string): Promise<void> {
  const cleanMessage = message.trim();
  if (!cleanMessage) throw new Error('No hay información para compartir.');
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(cleanMessage)}`;
  try {
    await Linking.openURL(whatsappUrl);
  } catch (error) {
    console.error('[Cuánto Pago] No se pudo abrir WhatsApp:', error);
    await Share.share({ message: cleanMessage, title: 'Cuánto Pago' });
  }
}
