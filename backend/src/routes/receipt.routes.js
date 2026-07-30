import { Router } from 'express';
import multer from 'multer';
import { analyzeReceipt } from '../services/gemini.service.js';

const router = Router();
const maxImageMb = Number(process.env.MAX_IMAGE_MB || 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageMb * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('El archivo debe ser una imagen.'));
      return;
    }
    callback(null, true);
  },
});

router.post('/analyze', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Debes enviar una imagen en el campo image.' });
    }

    const result = await analyzeReceipt({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
