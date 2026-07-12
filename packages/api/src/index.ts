import express from 'express';
// Patches express so errors thrown in async route handlers reach the error
// middleware instead of crashing the process (express 4 doesn't catch them).
import 'express-async-errors';
import { env } from './config/env';
import { connectRedis } from './config/redis';
import { webhookRouter } from './routes/webhooks';
import { authRouter } from './routes/auth';
import { oauthRouter } from './routes/oauth';
import { accountRouter } from './routes/account';
import { careProfilesRouter } from './routes/careProfiles';
import { careCircleRouter } from './routes/careCircle';
import { invitationsRouter } from './routes/invitations';
import { careLogRouter } from './routes/careLog';
import { carePlanRouter } from './routes/carePlan';
import { checklistsRouter } from './routes/checklists';
import { questionsRouter } from './routes/questions';
import { documentsRouter } from './routes/documents';
import { providersRouter } from './routes/providers';
import { remindersRouter } from './routes/reminders';
import { aiRouter } from './routes/ai';
import { aiDashboardRouter } from './routes/aiDashboard';
import { messagesRouter } from './routes/messages';
import { memoryBookRouter } from './routes/memoryBook';
import { calendarRouter, icsRouter } from './routes/calendar';
import { medicationsRouter } from './routes/medications';
import { medicationCatalogueRouter } from './routes/medicationCatalogue';
import { treatmentsRouter } from './routes/treatments';
import { deviceRouter } from './routes/deviceIngest';
import { lifeStagesRouter } from './routes/lifeStages';
import { allergiesRouter, conditionsRouter } from './routes/healthFacts';
import { conditionCatalogueRouter } from './routes/conditionCatalogue';
import { optionCatalogueRouter } from './routes/optionCatalogue';
import { notificationsRouter } from './routes/notifications';
import { journeyTemplatesRouter } from './routes/journeyTemplates';
import { journeysRouter } from './routes/journeys';
import { startReminderScheduler } from './services/scheduler';
import { startMarArchiveScheduler } from './services/marArchive';
import { subscriptionsRouter } from './routes/subscriptions';
import { adminRouter } from './routes/admin';
import { errorHandler, notFound } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';
import { requireCareProfileAccess } from './middleware/subscriptionGate';
import { auditTrail, blockViewerWrites } from './middleware/permissions';
import { activityRouter } from './routes/activity';
import { ensureSuperAdmin, runMigrations } from './services/bootstrap';
import { loadSettings, seedSettingsFromEnv, subscribeSettingsInvalidation } from './config/settings';
import { settingsRouter } from './routes/settings';

// Backstop for promise rejections outside request handling (e.g. redis,
// timers). Log instead of taking the whole API down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

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
v1.use('/auth', oauthRouter);
v1.use('/account', accountRouter);
// Super-admin runtime settings. Must be registered before the admin router so
// its requireRole('admin') guard doesn't shadow the super-admin-only routes.
v1.use('/admin/settings', settingsRouter);
v1.use('/admin', adminRouter);
v1.use('/subscriptions', subscriptionsRouter);
// Shared, instance-wide medication catalogue (read for all; add for admins;
// edit/delete for super admins).
v1.use('/medication-catalogue', medicationCatalogueRouter);
// Shared condition catalogue: read for everyone signed in; grows implicitly
// as people record conditions that are not in it yet.
v1.use('/condition-catalogue', conditionCatalogueRouter);
// Shared option lists (allergens, dietary requirements, mobility aids, …)
// backing the dropdowns that replaced free-text boxes. Read for everyone
// signed in; grows implicitly as people save unlisted values.
v1.use('/option-catalogue', optionCatalogueRouter);
// The notification bell: everything new across every profile the account
// can see, with per-item read state.
v1.use('/notifications', notificationsRouter);
// The care journey library: life stages and journey templates. Read for
// everyone signed in; shaped by admins.
v1.use('/life-stages', lifeStagesRouter);
v1.use('/journey-templates', journeyTemplatesRouter);
// Public receiving end of invitations: look up by token, accept, or
// create the account and accept in one step.
v1.use('/invitations', invitationsRouter);
// Pare's dashboard conversation: account-wide, sees a summary of every
// profile the account can reach, no single profile open.
v1.use('/ai/dashboard', aiDashboardRouter);
v1.use('/care-profiles', careProfilesRouter);
// Sub-resources verify profile ownership/membership here — the routers
// themselves only scope queries by the :id param. Viewers are read-only
// (plus conversation), and every successful change lands in the audit log.
const profileAccess = [requireAuth, requireCareProfileAccess, blockViewerWrites, auditTrail];
v1.use('/care-profiles/:id/circle', ...profileAccess, careCircleRouter);
v1.use('/care-profiles/:id/log', ...profileAccess, careLogRouter);
v1.use('/care-profiles/:id/plan', ...profileAccess, carePlanRouter);
v1.use('/care-profiles/:id/checklists', ...profileAccess, checklistsRouter);
v1.use('/care-profiles/:id/journeys', ...profileAccess, journeysRouter);
v1.use('/care-profiles/:id/allergies', ...profileAccess, allergiesRouter);
v1.use('/care-profiles/:id/conditions', ...profileAccess, conditionsRouter);
v1.use('/care-profiles/:id/questions', ...profileAccess, questionsRouter);
v1.use('/care-profiles/:id/documents', ...profileAccess, documentsRouter);
v1.use('/care-profiles/:id/providers', ...profileAccess, providersRouter);
v1.use('/care-profiles/:id/reminders', ...profileAccess, remindersRouter);
v1.use('/care-profiles/:id/medications', ...profileAccess, medicationsRouter);
v1.use('/care-profiles/:id/treatments', ...profileAccess, treatmentsRouter);
v1.use('/care-profiles/:id/ai', ...profileAccess, aiRouter);
v1.use('/care-profiles/:id/messages', ...profileAccess, messagesRouter);
v1.use('/care-profiles/:id/memory-book', ...profileAccess, memoryBookRouter);
v1.use('/care-profiles/:id/activity', ...profileAccess, activityRouter);
v1.use('/care-profiles/:id/calendar', ...profileAccess, calendarRouter);
// Public: token-authenticated read-only calendar feed for Google/Outlook
v1.use('/calendar', icsRouter);
// Public: device-key-authenticated ingestion, so machines (CPAP units,
// meter bridges) push their own readings straight into the observation log.
v1.use('/device', deviceRouter);

v1.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1', v1);

app.use(notFound);
app.use(errorHandler);

async function start(): Promise<void> {
  try {
    await connectRedis();
    await runMigrations();
    await ensureSuperAdmin();
    await seedSettingsFromEnv();
    await loadSettings();
    await subscribeSettingsInvalidation();
    startReminderScheduler();
    startMarArchiveScheduler();
    app.listen(env.PORT, () => {
      console.log(`PareCare API running on port ${env.PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
