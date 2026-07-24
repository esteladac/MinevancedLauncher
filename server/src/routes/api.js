const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../db/connection');

router.get('/manifests/files/:id.json', (req, res) => {
    // Check database for custom modpacks
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

module.exports = router;
