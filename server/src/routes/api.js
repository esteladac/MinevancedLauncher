const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');

router.get('/manifests', (req, res) => {
    const builtInPath = path.join(dataDir, 'manifests.json');
    if (fs.existsSync(builtInPath)) {
        try {
            const manifests = JSON.parse(fs.readFileSync(builtInPath, 'utf8'));
            return res.json(manifests);
        } catch {
            return res.json([]);
        }
    }
    res.json([]);
});

router.get('/manifests/files/:id.json', (req, res) => {
    const filePath = path.join(dataDir, 'manifests', `${req.params.id}.json`);
    if (fs.existsSync(filePath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return res.json(manifest);
        } catch {
            return res.status(500).json({ error: 'Failed to parse manifest' });
        }
    }
    res.status(404).json({ error: 'Manifest not found' });
});

router.post('/invite/resolve', (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'Invite code required' });
    }

    const invitesPath = path.join(dataDir, 'invites.json');
    if (fs.existsSync(invitesPath)) {
        try {
            const invites = JSON.parse(fs.readFileSync(invitesPath, 'utf8'));
            const invite = invites[code];
            if (invite) {
                return res.json(invite);
            }
        } catch {
            // fall through
        }
    }

    res.status(404).json({ error: 'Invalid invite code' });
});

router.post('/api/crash-logs', (req, res) => {
    const { username, modpack, log } = req.body;
    if (!log) {
        return res.status(400).json({ error: 'No log provided' });
    }

    const logsDir = path.join(dataDir, 'crash-logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${username || 'unknown'}_${modpack || 'general'}_${timestamp}.log`;
    fs.writeFileSync(path.join(logsDir, filename), log);

    res.json({ success: true, message: 'Crash log uploaded' });
});

module.exports = router;
