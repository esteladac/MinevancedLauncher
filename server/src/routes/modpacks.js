const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/connection');
const { requireAdmin } = require('../auth/middleware');
const config = require('../config');

const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');
const coversDir = path.join(uploadsDir, 'covers');
const modsDir = path.join(uploadsDir, 'mods');

[coversDir, modsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const coverStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, coversDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
});
const coverUpload = multer({ storage: coverStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('Only images allowed'));
}});

const modStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const pack = db.prepare('SELECT pack_id FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return cb(new Error('Modpack not found'));
        const dir = path.join(modsDir, pack.pack_id);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const modUpload = multer({ storage: modStorage, limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.jar')) cb(null, true); else cb(new Error('Only .jar files allowed'));
}});

function buildManifest(modpack) {
    const mods = db.prepare('SELECT * FROM modpack_mods WHERE modpack_id = ? ORDER BY sort_order').all(modpack.id);
    return {
        id: modpack.pack_id,
        name: modpack.name,
        minecraftVersion: modpack.minecraft_version,
        modLoader: modpack.mod_loader,
        modLoaderVersion: modpack.loader_version || 'latest',
        description: modpack.description || '',
        coverImage: modpack.cover_image ? (modpack.cover_image.startsWith('http') || modpack.cover_image.startsWith('data:') ? modpack.cover_image : `${config.serverUrl}${modpack.cover_image}`) : '',
        author: modpack.author || 'Unknown',
        version: modpack.version || '1.0.0',
        mods: mods.map(m => ({
            name: m.name,
            version: m.version || 'latest',
            downloadUrl: m.file_path ? `${config.serverUrl}/uploads/mods/${modpack.pack_id}/${path.basename(m.file_path)}` : m.download_url
        })),
        files: []
    };
}

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code.slice(0, 4) + '-' + code.slice(4);
}

// --- PUBLIC ENDPOINTS (for clients) ---

router.get('/api/modpacks', (req, res) => {
    try {
        const packs = db.prepare('SELECT * FROM modpacks WHERE is_published = 1 ORDER BY name').all();
        res.json(packs.map(p => buildManifest(p)));
    } catch (error) {
        console.error('[MODPACKS] List error:', error);
        res.status(500).json({ error: 'Failed to fetch modpacks' });
    }
});

router.get('/api/modpacks/:packId', (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE pack_id = ? AND is_published = 1').get(req.params.packId);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });
        res.json(buildManifest(pack));
    } catch (error) {
        console.error('[MODPACKS] Fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch modpack' });
    }
});

// --- INVITE RESOLVE (DB-based) ---

router.post('/invite/resolve', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Invite code required' });

    try {
        const invite = db.prepare('SELECT ic.*, m.* FROM invite_codes ic JOIN modpacks m ON ic.modpack_id = m.id WHERE ic.code = ? AND ic.is_active = 1').get(code);
        if (!invite) return res.status(404).json({ error: 'Invalid invite code' });

        if (invite.max_uses && invite.use_count >= invite.max_uses) {
            return res.status(403).json({ error: 'Invite code has reached maximum uses' });
        }

        db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE code = ?').run(code);

        const modpack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(invite.modpack_id);
        res.json({ success: true, manifest: buildManifest(modpack) });
    } catch (error) {
        console.error('[INVITE] Resolve error:', error);
        res.status(500).json({ error: 'Failed to resolve invite code' });
    }
});

// --- COVER IMAGE UPLOAD ---

router.post('/admin/api/uploads/cover', requireAdmin, coverUpload.single('cover'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, url: `/uploads/covers/${req.file.filename}` });
});

// --- ADMIN: MODPACK CRUD ---

router.get('/admin/api/modpacks', requireAdmin, (req, res) => {
    try {
        const packs = db.prepare('SELECT * FROM modpacks ORDER BY name').all();
        const result = packs.map(p => {
            const mods = db.prepare('SELECT COUNT(*) as count FROM modpack_mods WHERE modpack_id = ?').get(p.id);
            return { ...buildManifest(p), mod_count: mods.count, is_builtin: p.is_builtin, is_published: p.is_published, db_id: p.id };
        });
        res.json({ packs: result });
    } catch (error) {
        console.error('[MODPACKS] Admin list error:', error);
        res.status(500).json({ error: 'Failed to fetch modpacks' });
    }
});

router.get('/admin/api/modpacks/:id', requireAdmin, (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });
        const mods = db.prepare('SELECT * FROM modpack_mods WHERE modpack_id = ? ORDER BY sort_order').all(pack.id);
        const invites = db.prepare('SELECT * FROM invite_codes WHERE modpack_id = ?').all(pack.id);
        res.json({ ...buildManifest(pack), is_builtin: pack.is_builtin, is_published: pack.is_published, db_id: pack.id, mods, invites });
    } catch (error) {
        console.error('[MODPACKS] Admin fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch modpack' });
    }
});

router.post('/admin/api/modpacks', requireAdmin, (req, res) => {
    try {
        const { pack_id, name, description, cover_image, minecraft_version, mod_loader, loader_version, author, version } = req.body;
        if (!name || !minecraft_version || !mod_loader) {
            return res.status(400).json({ error: 'Name, minecraft_version, and mod_loader are required' });
        }
        const slug = (pack_id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const existing = db.prepare('SELECT id FROM modpacks WHERE pack_id = ?').get(slug);
        if (existing) return res.status(409).json({ error: 'Pack ID already exists' });

        const result = db.prepare(`
            INSERT INTO modpacks (pack_id, name, description, cover_image, minecraft_version, mod_loader, loader_version, author, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(slug, name, description || null, cover_image || null, minecraft_version, mod_loader, loader_version || 'latest', author || null, version || '1.0.0');

        const modpack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(result.lastInsertRowid);
        res.json({ success: true, modpack });
    } catch (error) {
        console.error('[MODPACKS] Create error:', error);
        res.status(500).json({ error: 'Failed to create modpack' });
    }
});

router.put('/admin/api/modpacks/:id', requireAdmin, (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });

        const { name, description, cover_image, minecraft_version, mod_loader, loader_version, author, version, is_published } = req.body;
        db.prepare(`
            UPDATE modpacks SET name = ?, description = ?, cover_image = ?, minecraft_version = ?,
            mod_loader = ?, loader_version = ?, author = ?, version = ?, is_published = ?, updated_at = datetime('now')
            WHERE id = ?
        `).run(
            name || pack.name,
            description !== undefined ? description : pack.description,
            cover_image !== undefined ? cover_image : pack.cover_image,
            minecraft_version || pack.minecraft_version,
            mod_loader || pack.mod_loader,
            loader_version !== undefined ? loader_version : pack.loader_version,
            author !== undefined ? author : pack.author,
            version || pack.version,
            is_published !== undefined ? (is_published ? 1 : 0) : pack.is_published,
            req.params.id
        );

        const updated = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        res.json({ success: true, modpack: updated });
    } catch (error) {
        console.error('[MODPACKS] Update error:', error);
        res.status(500).json({ error: 'Failed to update modpack' });
    }
});

router.delete('/admin/api/modpacks/:id', requireAdmin, (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });
        if (pack.is_builtin) return res.status(403).json({ error: 'Cannot delete builtin modpack' });

        const mods = db.prepare('SELECT file_path FROM modpack_mods WHERE modpack_id = ?').all(pack.id);
        mods.forEach(m => {
            if (m.file_path) {
                const full = path.join(modsDir, pack.pack_id, path.basename(m.file_path));
                if (fs.existsSync(full)) fs.unlinkSync(full);
            }
        });
        const modDir = path.join(modsDir, pack.pack_id);
        if (fs.existsSync(modDir)) fs.rmSync(modDir, { recursive: true, force: true });

        if (pack.cover_image && pack.cover_image.startsWith('/uploads/covers/')) {
            const coverFile = path.join(coversDir, path.basename(pack.cover_image));
            if (fs.existsSync(coverFile)) fs.unlinkSync(coverFile);
        }

        db.prepare('DELETE FROM modpacks WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('[MODPACKS] Delete error:', error);
        res.status(500).json({ error: 'Failed to delete modpack' });
    }
});

router.patch('/admin/api/modpacks/:id/publish', requireAdmin, (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });
        const newVal = pack.is_published ? 0 : 1;
        db.prepare('UPDATE modpacks SET is_published = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newVal, req.params.id);
        res.json({ success: true, is_published: newVal });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle publish' });
    }
});

// --- ADMIN: MOD MANAGEMENT ---

router.get('/admin/api/modpacks/:id/mods', requireAdmin, (req, res) => {
    try {
        const mods = db.prepare('SELECT * FROM modpack_mods WHERE modpack_id = ? ORDER BY sort_order').all(req.params.id);
        res.json(mods);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch mods' });
    }
});

router.post('/admin/api/modpacks/:id/mods', requireAdmin, (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });

        const { name, version, download_url, source_id } = req.body;
        if (!name) return res.status(400).json({ error: 'Mod name is required' });

        const maxOrder = db.prepare('SELECT MAX(sort_order) as mx FROM modpack_mods WHERE modpack_id = ?').get(req.params.id);
        const result = db.prepare(`
            INSERT INTO modpack_mods (modpack_id, name, version, download_url, source, source_id, sort_order)
            VALUES (?, ?, ?, ?, 'url', ?, ?)
        `).run(req.params.id, name, version || null, download_url || null, source_id || null, (maxOrder.mx || 0) + 1);

        const mod = db.prepare('SELECT * FROM modpack_mods WHERE id = ?').get(result.lastInsertRowid);
        res.json({ success: true, mod });
    } catch (error) {
        console.error('[MODS] Add error:', error);
        res.status(500).json({ error: 'Failed to add mod' });
    }
});

router.post('/admin/api/modpacks/:id/mods/upload', requireAdmin, modUpload.single('mod'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });

        const name = req.body.name || req.file.originalname.replace(/-\d+.*\.jar$/, '').replace('.jar', '');
        const version = req.body.version || 'latest';
        const maxOrder = db.prepare('SELECT MAX(sort_order) as mx FROM modpack_mods WHERE modpack_id = ?').get(req.params.id);

        const result = db.prepare(`
            INSERT INTO modpack_mods (modpack_id, name, version, file_path, source, sort_order)
            VALUES (?, ?, ?, ?, 'upload', ?)
        `).run(req.params.id, name, version, req.file.filename, (maxOrder.mx || 0) + 1);

        const mod = db.prepare('SELECT * FROM modpack_mods WHERE id = ?').get(result.lastInsertRowid);
        res.json({ success: true, mod });
    } catch (error) {
        console.error('[MODS] Upload error:', error);
        res.status(500).json({ error: 'Failed to upload mod' });
    }
});

router.delete('/admin/api/modpacks/:id/mods/:modId', requireAdmin, (req, res) => {
    try {
        const mod = db.prepare('SELECT * FROM modpack_mods WHERE id = ? AND modpack_id = ?').get(req.params.modId, req.params.id);
        if (!mod) return res.status(404).json({ error: 'Mod not found' });

        if (mod.file_path) {
            const pack = db.prepare('SELECT pack_id FROM modpacks WHERE id = ?').get(req.params.id);
            const full = path.join(modsDir, pack.pack_id, mod.file_path);
            if (fs.existsSync(full)) fs.unlinkSync(full);
        }
        db.prepare('DELETE FROM modpack_mods WHERE id = ?').run(req.params.modId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete mod' });
    }
});

// --- ADMIN: INVITE CODES ---

router.post('/admin/api/modpacks/:id/invite', requireAdmin, (req, res) => {
    try {
        const pack = db.prepare('SELECT * FROM modpacks WHERE id = ?').get(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Modpack not found' });

        let code;
        let attempts = 0;
        do { code = generateCode(); attempts++; }
        while (db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code) && attempts < 10);

        const { max_uses } = req.body || {};
        const result = db.prepare('INSERT INTO invite_codes (code, modpack_id, max_uses) VALUES (?, ?, ?)').run(code, req.params.id, max_uses || null);
        const invite = db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(result.lastInsertRowid);
        res.json({ success: true, invite });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate invite code' });
    }
});

router.delete('/admin/api/modpacks/invites/:codeId', requireAdmin, (req, res) => {
    try {
        db.prepare('DELETE FROM invite_codes WHERE id = ?').run(req.params.codeId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to revoke invite code' });
    }
});

// --- ADMIN: MODRINTH PROXY ---

router.get('/admin/api/modrinth/search', requireAdmin, async (req, res) => {
    try {
        const { q, facets, limit = 20, offset = 0 } = req.query;
        const params = new URLSearchParams({ limit, offset, index: 'relevance' });
        if (q) params.set('query', q);
        if (facets) params.set('facets', facets);

        const response = await fetch(`https://api.modrinth.com/v2/search?${params}`, {
            headers: { 'User-Agent': 'MinevancedLauncher/1.0 (contact@minevanced.com)' }
        });
        if (!response.ok) return res.status(response.status).json({ error: 'Modrinth API error' });
        res.json(await response.json());
    } catch (error) {
        console.error('[MODRINTH] Search error:', error);
        res.status(500).json({ error: 'Failed to search Modrinth' });
    }
});

router.get('/admin/api/modrinth/mod/:id/versions', requireAdmin, async (req, res) => {
    try {
        const params = new URLSearchParams();
        if (req.query.loaders) params.set('loaders', req.query.loaders);
        if (req.query.versions) params.set('game_versions', req.query.versions);
        const url = `https://api.modrinth.com/v2/project/${req.params.id}/version${params.toString() ? '?' + params : ''}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'MinevancedLauncher/1.0 (contact@minevanced.com)' }
        });
        if (!response.ok) return res.status(response.status).json({ error: 'Modrinth API error' });
        res.json(await response.json());
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch versions from Modrinth' });
    }
});

router.get('/admin/api/loader-versions', requireAdmin, async (req, res) => {
    try {
        const { loader, minecraft_version } = req.query;
        if (!loader || !minecraft_version) return res.json([]);

        if (loader === 'fabric') {
            const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${minecraft_version}`, {
                headers: { 'User-Agent': 'MinevancedLauncher/1.0' }
            });
            if (!response.ok) return res.json([]);
            const data = await response.json();
            return res.json(data.map(v => v.version));
        }

        if (loader === 'quilt') {
            const response = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${minecraft_version}`, {
                headers: { 'User-Agent': 'MinevancedLauncher/1.0' }
            });
            if (!response.ok) return res.json([]);
            const data = await response.json();
            return res.json(data.map(v => v.version));
        }

        if (loader === 'forge') {
            const response = await fetch(`https://files.minecraftforge.net/maven/net/minecraftforge/forge/maven-metadata.xml`, {
                headers: { 'User-Agent': 'MinevancedLauncher/1.0' }
            });
            if (!response.ok) return res.json([]);
            const xml = await response.text();
            const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
                .map(m => m[1])
                .filter(v => v.startsWith(minecraft_version + '-'))
                .sort().reverse();
            return res.json(versions);
        }

        if (loader === 'neoforge') {
            const response = await fetch(`https://api.neoforged.net/versions/loader?game_version=${encodeURIComponent(minecraft_version)}`, {
                headers: { 'User-Agent': 'MinevancedLauncher/1.0' }
            });
            if (!response.ok) return res.json([]);
            const data = await response.json();
            return res.json(data.map(v => v.version).sort().reverse());
        }

        res.json([]);
    } catch (error) {
        console.error('[LOADER-VERSIONS] Error:', error);
        res.json([]);
    }
});

// --- SEED BUILTIN MODPACKS ---

function seedBuiltinPacks() {
    const builtinFile = path.join(__dirname, '..', '..', '..', 'src', '.builtin-packs.json');
    if (!fs.existsSync(builtinFile)) return;
    try {
        const packs = JSON.parse(fs.readFileSync(builtinFile, 'utf8'));
        packs.forEach(p => {
            const existing = db.prepare('SELECT id FROM modpacks WHERE pack_id = ?').get(p.id);
            if (!existing) {
                db.prepare(`
                    INSERT INTO modpacks (pack_id, name, description, cover_image, minecraft_version, mod_loader, loader_version, author, version, is_published, is_builtin)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
                `).run(p.id, p.name, p.description || null, null, p.minecraftVersion, p.modLoader, p.modLoaderVersion || 'latest', p.author || 'Minevanced Team', p.version || '1.0.0');
                console.log(`[MODPACKS] Seeded builtin: ${p.name}`);
            }
        });
    } catch (error) {
        console.error('[MODPACKS] Seed error:', error);
    }
}

module.exports = router;
module.exports.seedBuiltinPacks = seedBuiltinPacks;
