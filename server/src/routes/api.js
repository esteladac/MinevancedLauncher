const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');

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

    // Fallback: check database for custom modpacks
    try {
        let pack = db.prepare('SELECT * FROM modpacks WHERE pack_id = ? AND is_published = 1').get(req.params.id);

        // If not published, check if a valid invite code was provided
        if (!pack && req.query.code) {
            const invite = db.prepare(
                'SELECT m.* FROM invite_codes ic JOIN modpacks m ON ic.modpack_id = m.id WHERE ic.code = ? AND ic.is_active = 1'
            ).get(req.query.code);
            if (invite) {
                db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE code = ?').run(req.query.code);
                pack = invite;
            }
        }

        if (pack) {
            const mods = db.prepare('SELECT * FROM modpack_mods WHERE modpack_id = ? ORDER BY sort_order').all(pack.id);
            const serverUrl = require('../config').serverUrl;
            return res.json({
                id: pack.pack_id,
                name: pack.name,
                minecraftVersion: pack.minecraft_version,
                modLoader: pack.mod_loader,
                modLoaderVersion: pack.loader_version || 'latest',
                description: pack.description || '',
                coverImage: pack.cover_image ? (pack.cover_image.startsWith('http') ? pack.cover_image : `${serverUrl}${pack.cover_image}`) : '',
                author: pack.author || 'Unknown',
                version: pack.version || '1.0.0',
                mods: mods.map(m => ({
                    name: m.name,
                    version: m.version || 'latest',
                    downloadUrl: m.file_path ? `${serverUrl}/uploads/mods/${pack.pack_id}/${path.basename(m.file_path)}` : m.download_url
                })),
                files: []
            });
        }
    } catch (err) {
        console.error('[API] DB manifest fallback error:', err);
    }

    res.status(404).json({ error: 'Manifest not found' });
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
