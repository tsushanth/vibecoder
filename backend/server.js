// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import subscriptionsRoutes from './routes/subscriptions.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import authRoutes from './routes/auth.routes.js';
import deployRoutes from './routes/deploy.routes.js';
import domainsRoutes from './routes/domains.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({
    origin: [
        'https://vibebuild.cc',
        'https://www.vibebuild.cc',
        'https://vibebuild-web-917362189743.us-central1.run.app',
        'http://localhost:3000',
    ],
    credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

// Health
app.get('/api/health', (req, res) => {
    res.json({ healthy: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/domains', domainsRoutes);

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`VibeCoder backend running on http://localhost:${PORT}`);
});
