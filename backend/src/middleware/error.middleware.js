export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
}

export function errorHandler(error, _req, res, _next) {
  console.error(error);

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'La imagen supera el tamaño máximo permitido.' });
  }

  const status = Number(error?.status || 500);
  const message = status >= 500 ? error?.message || 'Error interno del servidor.' : error.message;
  return res.status(status).json({ error: message });
}
