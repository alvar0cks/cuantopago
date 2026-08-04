import { Linking, Platform, Share } from 'react-native';

export async function shareOnWhatsApp(message: string): Promise<void> {
  const cleanMessage = message.trim();

  if (!cleanMessage) {
    throw new Error('No hay información para compartir.');
  }

  const encodedMessage = encodeURIComponent(cleanMessage);

  // El enlace HTTPS evita los problemas de canOpenURL con whatsapp://
  // y abre WhatsApp cuando está instalado.
  const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;

  try {
    await Linking.openURL(whatsappUrl);
  } catch (error) {
    console.error('[Cuánto Pago] No se pudo abrir WhatsApp:', error);

    // Respaldo: abre el menú nativo para compartir.
    const result = await Share.share({
      message: cleanMessage,
      title: 'Cuánto Pago',
    });

    if (
      Platform.OS !== 'ios' &&
      result.action === Share.dismissedAction
    ) {
      throw new Error('No se pudo compartir el mensaje.');
    }
  }
}