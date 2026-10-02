import { Linking, Share } from 'react-native';
import * as Sharing from 'expo-sharing';

export async function shareOnWhatsApp(message: string): Promise<void> {
  const cleanMessage = message.trim();
  if (!cleanMessage) throw new Error('No hay información para compartir.');
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(cleanMessage)}`;
  try { await Linking.openURL(whatsappUrl); }
  catch (error) {
    console.log('[Cuánto Pago] No se pudo abrir WhatsApp:', error);
    await Share.share({ message: cleanMessage, title: 'Cuánto Pago' });
  }
}

export async function shareImage(uri: string): Promise<void> {
  if (!uri) throw new Error('No hay imagen para compartir.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir imágenes no está disponible en este dispositivo.');
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Compartir resumen de Cuánto Pago', UTI: 'public.png' });
}
