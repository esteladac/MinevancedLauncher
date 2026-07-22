const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { initSchema } = require('./db/schema');
const { cleanupSessions } = require('./auth/middleware');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const bugReportRoutes = require('./routes/bug-reports');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// Serve admin panel
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Routes
app.use('/auth', authRoutes);
app.use('/admin/api', adminRoutes);
app.use('/', apiRoutes);
app.use('/', bugReportRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize
initSchema();

// Clean up expired sessions every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000);

const server = app.listen(config.port, () => {
    console.log(`Minevanced server running on port ${config.port}`);
    console.log(`Admin panel: ${config.serverUrl}/admin`);
});

module.exports = { app, server };
