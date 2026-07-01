import express from 'express';
import { env } from './config/env';
import { connectRedis } from './config/redis';
import { webhookRouter } from './routes/webhooks';
import { authRouter } from './routes/auth';
import { careProfilesRouter } from './routes/careProfiles';
import { careCircleRouter, inviteRouter } from './routes/careCircle';
import { careLogRouter } from './routes/careLog';
import { carePlanRouter } from './routes/carePlan';
import { checklistsRouter } from './routes/checklists';
import { questionsRouter } from './routes/questions';
import { documentsRouter } from './routes/documents';
import { providersRouter } from './routes/providers';
import { remindersRouter } from './routes/reminders';
import { aiRouter } from './routes/ai';
import { subscriptionsRouter } from './routes/subscriptions';
import { adminRouter } from './routes/admin';
import { errorHandler, notFound } from './middleware/errorHandler';
import { ensureSuperAdmin } from './services/bootstrap';

const app = express();

// Stripe webhooks MUST come before express.json() — needs raw body
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), webhookRouter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const v1 = express.Router();

v1.use('/auth', authRouter);
v1.use('/admin', adminRouter);
v1.use('/subscriptions', subscriptionsRouter);
v1.use('/care-circle', inviteRouter);
v1.use('/care-profiles', careProfilesRouter);
v1.use('/care-profiles/:id/circle', careCircleRouter);
v1.use('/care-profiles/:id/log', careLogRouter);
v1.use('/care-profiles/:id/plan', carePlanRouter);
v1.use('/care-profiles/:id/checklists', checklistsRouter);
v1.use('/care-profiles/:id/questions', questionsRouter);
v1.use('/care-profiles/:id/documents', documentsRouter);
v1.use('/care-profiles/:id/providers', providersRouter);
v1.use('/care-profiles/:id/reminders', remindersRouter);
v1.use('/care-profiles/:id/ai', aiRouter);

v1.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1', v1);

app.use(notFound);
app.use(errorHandler);

async function start(): Promise<void> {
  try {
    await connectRedis();
    await ensureSuperAdmin();
    app.listen(env.PORT, () => {
      console.log(`PareCare API running on port ${env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
