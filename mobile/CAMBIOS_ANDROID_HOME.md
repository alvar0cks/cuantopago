# Ajustes Android + Home

Cambios aplicados:

- Se reemplazó `FileSystem.uploadAsync` por `fetch + FormData` en `src/services/api.ts` para evitar el error de Android al subir la boleta de prueba (`Directory for ... doesn't exist`).
- Se mantuvo como base la versión `App_CuantoPago_Propina_Corregida(1).tsx`, incluyendo la corrección del cálculo de propina.
- En Home, "Escanear boleta" ahora se fuerza a dos líneas limpias para evitar que Android corte la palabra como `Esca / near`.
- Se eliminó completamente la navegación inferior: Inicio, Historial, Grupos y Ajustes.
- Se eliminó el símbolo `>` de la tarjeta "Sin registro" para que no parezca presionable.
- Se redujo el espacio inferior del Home porque ya no existe la barra de navegación.

## Cambio: aviso si Gemini demora
- Al iniciar el análisis se mantiene el mensaje habitual.
- Si pasan 8 segundos, el mensaje cambia automáticamente a: “Está tomando un poco más de lo normal” y “Seguimos procesando tu boleta. No necesitas hacer nada.”
- La consulta no se cancela ni se reintenta; solo cambia la respuesta visual para evitar que el usuario piense que la app quedó congelada.
