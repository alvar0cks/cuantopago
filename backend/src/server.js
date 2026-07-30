import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import receiptRoutes from './routes/receipt.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = process.env.ALLOWED_ORIGINS || '*';

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins === '*' ? true : allowedOrigins.split(',').map((value) => value.trim()),
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'cuantopago-backend' });
});

app.use('/api/receipts', receiptRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, '0.0.0.0', () => {
  console.log(`Cuánto Pago backend disponible en http://localhost:${port}`);
});
