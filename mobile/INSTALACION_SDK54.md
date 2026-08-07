# Cuánto Pago — Expo SDK 54

Esta versión conserva el proyecto actual y el rediseño inspirado en la landing, pero fija el proyecto móvil en Expo SDK 54 para usarlo con Expo Go SDK 54.

## Instalación limpia

Desde la carpeta `mobile`:

```bash
rm -rf node_modules package-lock.json .expo
npm install
npx expo install --fix
npx expo start -c --lan
```

Si Expo Go conserva un proyecto anterior en caché, ciérralo completamente y vuelve a escanear el QR generado por este proyecto.

## Versiones principales

- Expo SDK 54
- React 19.1
- React Native 0.81.5
- expo-image-picker 17
- expo-asset 12
- expo-clipboard 8
- expo-status-bar 3
- react-native-safe-area-context 5.6

No se incluye `node_modules` ni un `package-lock.json` antiguo para evitar arrastrar dependencias de SDK 57.
