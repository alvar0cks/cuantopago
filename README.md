# Cuánto Pago

Migración de la app Streamlit **Págame** a una arquitectura móvil segura:

- `mobile/`: React Native con Expo para iOS y Android.
- `backend/`: API Node.js + Express que consulta Gemini.
- La clave de Gemini permanece únicamente en el backend.

## 1. Ejecutar el backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Completa `GEMINI_API_KEY` en `.env`.

## 2. Ejecutar la app móvil

```bash
cd mobile
cp .env.example .env
npm install
npx expo start
```

En `.env`, configura `EXPO_PUBLIC_API_URL` con la URL del backend.

- Simulador iOS: `http://localhost:3000`
- Emulador Android: `http://10.0.2.2:3000`
- Teléfono físico: usa la IP local del computador, por ejemplo `http://192.168.1.20:3000`

## Flujo incluido

1. Tomar o seleccionar foto de la boleta.
2. Extraer productos, total, propina, impuestos y descuentos con Gemini.
3. Revisar, editar, agregar o eliminar ítems.
4. Agregar personas.
5. Asignar cada consumo a una o varias personas.
6. Elegir quién pagó y agregar datos de transferencia.
7. Calcular la parte de cada persona con propina.
8. Compartir el resumen o los cobros individuales por WhatsApp.

