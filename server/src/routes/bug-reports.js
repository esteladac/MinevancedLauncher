const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAdmin } = require('../auth/middleware');

router.post('/api/bug-reports', (req, res) => {
    try {
        const {
            type, title, description, stack, message,
            platform, arch, nodeVersion, electronVersion, appVersion,
            mc_version, modpack, username, client_logs
        } = req.body;

        if (!type) {
            return res.status(400).json({ error: 'Report type is required' });
        }

        const stmt = db.prepare(`
            INSERT INTO bug_reports (type, title, description, stack, message, platform, arch, nodeVersion, electronVersion, appVersion, mc_version, modpack, username, client_logs)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            type,
            title || null,
            description || null,
            stack || null,
            message || null,
            platform || null,
            arch || null,
            nodeVersion || null,
            electronVersion || null,
            appVersion || null,
            mc_version || null,
            modpack || null,
            username || null,
            client_logs || null
        );

        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('[BUG REPORT] Insert error:', error);
        res.status(500).json({ error: 'Failed to save bug report' });
    }
});

router.get('/api/bug-reports', requireAdmin, (req, res) => {
    try {
        const { status, type, limit = 50, offset = 0 } = req.query;
        let query = 'SELECT * FROM bug_reports';
        const params = [];
        const conditions = [];

        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }
        if (type) {
            conditions.push('type = ?');
            params.push(type);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), Number(offset));

        const reports = db.prepare(query).all(...params);
        const total = db.prepare('SELECT COUNT(*) as count FROM bug_reports').get().count;

        res.json({ reports, total });
    } catch (error) {
        console.error('[BUG REPORT] Query error:', error);
        res.status(500).json({ error: 'Failed to fetch bug reports' });
    }
});

router.get('/api/bug-reports/:id', requireAdmin, (req, res) => {
    try {
        const report = db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json(report);
    } catch (error) {
        console.error('[BUG REPORT] Fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch bug report' });
    }
});

router.patch('/api/bug-reports/:id', requireAdmin, (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !['new', 'reviewed', 'fixed', 'wontfix'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }

        const result = db.prepare('UPDATE bug_reports SET status = ? WHERE id = ?').run(status, req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[BUG REPORT] Update error:', error);
        res.status(500).json({ error: 'Failed to update bug report' });
    }
});

module.exports = router;
