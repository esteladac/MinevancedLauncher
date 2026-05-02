require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const CURSEFORGE_API_KEY = process.env.CURSEFORGE_API_KEY || '';
const ADMIN_COOKIE_NAME = 'minevanced_admin_session';
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const DB_FILE = path.join(__dirname, 'users.json');
const INVITES_FILE = path.join(__dirname, 'invites.json');
const MANIFESTS_DIR = path.join(__dirname, '..', 'manifests');
const MODPACKS_DIR = path.join(__dirname, '..', 'modpacks');
const DASHBOARD_DIR = path.join(__dirname, 'public');
const TMP_DIR = path.join(__dirname, 'uploads');

const upload = multer({ dest: TMP_DIR });
const adminSessions = new Map();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use('/dashboard', express.static(DASHBOARD_DIR, { index: false }));
app.use('/modpacks', express.static(MODPACKS_DIR));
app.use('/manifests/files', express.static(MANIFESTS_DIR));

app.get(['/dashboard', '/dashboard/'], (req, res) => {
    res.sendFile(path.join(DASHBOARD_DIR, 'dashboard.html'));
});

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readJson(filePath, fallbackValue) {
    try {
        if (!fs.existsSync(filePath)) return fallbackValue;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function sanitizeSlug(value, fallbackValue = 'modpack') {
    const normalized = String(value || fallbackValue)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || fallbackValue;
}

function parseCookies(cookieHeader = '') {
    return cookieHeader.split(';').reduce((cookies, part) => {
        const index = part.indexOf('=');
        if (index === -1) return cookies;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function createAdminSession() {
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    return token;
}

function purgeExpiredSessions() {
    const now = Date.now();
    for (const [token, expiresAt] of adminSessions.entries()) {
        if (expiresAt <= now) {
            adminSessions.delete(token);
        }
    }
}

function isAdminAuthenticated(req) {
    purgeExpiredSessions();
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[ADMIN_COOKIE_NAME];
    if (!token) return false;
    const expiresAt = adminSessions.get(token);
    if (!expiresAt || expiresAt <= Date.now()) {
        adminSessions.delete(token);
        return false;
    }
    return true;
}

function requireAdmin(req, res, next) {
    if (!isAdminAuthenticated(req)) {
        return res.status(401).json({ error: 'Admin authentication required.' });
    }
    return next();
}

function setAdminCookie(res, token) {
    const cookie = `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`;
    res.setHeader('Set-Cookie', cookie);
}

function clearAdminCookie(res) {
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function loadUsers() {
    return readJson(DB_FILE, {});
}

function loadManifests() {
    ensureDir(MANIFESTS_DIR);
    const modpacks = [];

    for (const file of fs.readdirSync(MANIFESTS_DIR)) {
        if (!file.endsWith('.json') || file.startsWith('INVITE_')) continue;
        try {
            const manifest = readJson(path.join(MANIFESTS_DIR, file), null);
            if (!manifest) continue;
            manifest.id = manifest.id || file.replace(/\.json$/i, '');
            manifest.isOfficial = true;
            modpacks.push(manifest);
        } catch (error) {
            console.error('Failed to parse manifest json:', file, error);
        }
    }

    return modpacks;
}

function getPublicFileUrl(...segments) {
    const encoded = segments
        .flat()
        .filter(Boolean)
        .map((segment) => String(segment).split('/').map((part) => encodeURIComponent(part)).join('/'))
        .join('/');
    return `${PUBLIC_BASE_URL}/${encoded}`;
}

function resolveLoaderFromIndex(index) {
    const dependencies = index.dependencies || {};
    if (dependencies['fabric-loader']) {
        return { modLoader: 'fabric', modLoaderVersion: dependencies['fabric-loader'] };
    }
    if (dependencies.neoforge) {
        return { modLoader: 'neoforge', modLoaderVersion: dependencies.neoforge };
    }
    if (dependencies.forge) {
        return { modLoader: 'forge', modLoaderVersion: dependencies.forge };
    }
    if (dependencies.quilt_loader || dependencies['quilt-loader']) {
        return { modLoader: 'quilt', modLoaderVersion: dependencies.quilt_loader || dependencies['quilt-loader'] };
    }
    return { modLoader: 'vanilla', modLoaderVersion: 'latest' };
}

function hashEntry(entry) {
    if (!entry || typeof entry !== 'object') return { hash: '', hashAlgorithm: 'sha256' };
    if (entry.hashes?.sha512) return { hash: entry.hashes.sha512, hashAlgorithm: 'sha512' };
    if (entry.hashes?.sha1) return { hash: entry.hashes.sha1, hashAlgorithm: 'sha1' };
    if (entry.hashes?.sha256) return { hash: entry.hashes.sha256, hashAlgorithm: 'sha256' };
    return { hash: '', hashAlgorithm: 'sha256' };
}

async function fetchJson(url, options = {}) {
    const fetchImpl = global.fetch
        ? global.fetch.bind(global)
        : (await import('node-fetch')).default;

    const response = await fetchImpl(url, options);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }
    return response.json();
}

function writeManifest(manifest) {
    ensureDir(MANIFESTS_DIR);
    const filePath = path.join(MANIFESTS_DIR, `${manifest.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
    return filePath;
}

function buildManifestFromForm(body) {
    const id = sanitizeSlug(body.id, body.name || 'modpack');
    const manifest = {
        id,
        name: body.name || id,
        version: body.version || '1.0.0',
        minecraftVersion: body.minecraftVersion || 'latest',
        modLoader: body.modLoader || 'vanilla',
        modLoaderVersion: body.modLoaderVersion || 'latest',
        description: body.description || '',
        coverImage: body.coverImage || '',
        author: body.author || 'Minevanced Team',
        mods: Array.isArray(body.mods) ? body.mods : [],
        files: Array.isArray(body.files) ? body.files : [],
        createdAt: new Date().toISOString(),
        isOfficial: true
    };
    return manifest;
}

function encodePathSegments(relativePath) {
    return String(relativePath)
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/');
}

async function buildModrinthVersionPayload(projectId, gameVersion, loader) {
    const params = new URLSearchParams();
    if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
    if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]));

    const versions = await fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version?${params.toString()}`);
    if (!Array.isArray(versions) || versions.length === 0) {
        throw new Error('No matching Modrinth version was found.');
    }

    const version = versions[0];
    const file = version.files && version.files[0];
    if (!file || !file.url) {
        throw new Error('The selected Modrinth version does not expose a downloadable file.');
    }

    const hashInfo = hashEntry(file);
    return {
        name: version.name || file.filename || projectId,
        source: 'Modrinth',
        projectId,
        projectUrl: `https://modrinth.com/mod/${projectId}`,
        version: version.version_number || version.name || 'latest',
        downloadUrl: file.url,
        hash: hashInfo.hash,
        hashAlgorithm: hashInfo.hashAlgorithm,
        gameVersions: version.game_versions || [],
        loaders: version.loaders || []
    };
}

function extractModrinthOverrides(zip, importId) {
    const extractedFiles = [];
    const importRoot = path.join(MODPACKS_DIR, 'imports', importId);
    ensureDir(importRoot);

    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        if (!entry.entryName.startsWith('overrides/')) continue;

        const relativePath = entry.entryName.replace(/^overrides\//, '');
        if (!relativePath) continue;

        const outputPath = path.join(importRoot, relativePath);
        ensureDir(path.dirname(outputPath));
        fs.writeFileSync(outputPath, entry.getData());

        extractedFiles.push({
            path: relativePath.split('\\').join('/'),
            downloadUrl: getPublicFileUrl('modpacks', 'imports', importId, encodePathSegments(relativePath)),
            hash: '',
            hashAlgorithm: 'sha256'
        });
    }

    return extractedFiles;
}

app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        adminPasswordConfigured: !!ADMIN_PASSWORD,
        authenticated: isAdminAuthenticated(req),
        port: PORT
    });
});

app.get('/api/me', (req, res) => {
    res.json({ authenticated: isAdminAuthenticated(req) });
});

app.post('/admin/login', (req, res) => {
    const { password } = req.body || {};
    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'Admin password is not configured on the server.' });
    }
    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid admin password.' });
    }

    const token = createAdminSession();
    setAdminCookie(res, token);
    res.json({ success: true });
});

app.post('/admin/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[ADMIN_COOKIE_NAME];
    if (token) adminSessions.delete(token);
    clearAdminCookie(res);
    res.json({ success: true });
});

app.get('/api/modpacks', requireAdmin, (req, res) => {
    res.json({ success: true, modpacks: loadManifests() });
});

app.get('/manifests', (req, res) => {
    res.json({ success: true, modpacks: loadManifests() });
});

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const users = loadUsers();
    const user = users[username.toLowerCase()];

    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const hash = crypto.createHash('sha256').update(password).digest('hex');
    if (user.passwordHash !== hash) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({ success: true, username });
});

app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || username.length < 3 || password.length < 4) {
        return res.status(400).json({ error: 'Invalid username or password criteria' });
    }

    const users = loadUsers();
    const normalizedUsername = username.toLowerCase();
    if (users[normalizedUsername]) {
        return res.status(400).json({ error: 'Username already taken' });
    }

    users[normalizedUsername] = {
        passwordHash: crypto.createHash('sha256').update(password).digest('hex')
    };

    writeJson(DB_FILE, users);
    res.json({ success: true, message: 'User registered successfully' });
});

app.get('/api/modrinth/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
        return res.status(400).json({ error: 'Search query required.' });
    }

    try {
        const data = await fetchJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=20`);
        const results = (data.hits || []).map((item) => ({
            name: item.title,
            summary: item.description,
            author: item.author,
            projectId: item.project_id,
            projectUrl: `https://modrinth.com/mod/${item.slug}`,
            iconUrl: item.icon_url,
            downloads: item.downloads,
            updated: item.date_modified,
            source: 'Modrinth'
        }));
        res.json({ success: true, results });
    } catch (error) {
        console.error('Modrinth search failed:', error);
        res.status(500).json({ error: 'Failed to search Modrinth.' });
    }
});

app.get('/api/modrinth/latest', async (req, res) => {
    try {
        const projectId = String(req.query.projectId || '').trim();
        const gameVersion = String(req.query.gameVersion || '').trim();
        const loader = String(req.query.loader || '').trim();

        if (!projectId) {
            return res.status(400).json({ error: 'projectId is required.' });
        }

        const mod = await buildModrinthVersionPayload(projectId, gameVersion, loader);
        res.json({ success: true, mod });
    } catch (error) {
        console.error('Modrinth latest lookup failed:', error);
        res.status(500).json({ error: error.message || 'Failed to resolve Modrinth version.' });
    }
});

app.get('/api/curseforge/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
        return res.status(400).json({ error: 'Search query required.' });
    }

    if (!CURSEFORGE_API_KEY) {
        return res.json({
            success: true,
            note: 'CURSEFORGE_API_KEY is not set. Showing browse links only.',
            results: [
                {
                    name: `Search CurseForge for "${query}"`,
                    summary: 'Open the CurseForge web search directly.',
                    websiteUrl: `https://www.curseforge.com/minecraft/mc-mods/search?search=${encodeURIComponent(query)}`,
                    source: 'CurseForge'
                }
            ]
        });
    }

    try {
        const data = await fetchJson(`https://api.curseforge.com/v1/mods/search?gameId=432&pageSize=20&searchFilter=${encodeURIComponent(query)}`, {
            headers: {
                'x-api-key': CURSEFORGE_API_KEY,
                'Accept': 'application/json'
            }
        });

        const results = (data.data || []).map((item) => ({
            name: item.name,
            summary: item.summary,
            author: item.authors && item.authors[0] ? item.authors[0].name : 'Unknown',
            websiteUrl: item.links?.websiteUrl || `https://www.curseforge.com/minecraft/mc-mods/${item.slug || ''}`,
            source: 'CurseForge'
        }));
        res.json({ success: true, results });
    } catch (error) {
        console.error('CurseForge search failed:', error);
        res.status(500).json({ error: 'Failed to search CurseForge.' });
    }
});

app.post('/api/modpacks/create', requireAdmin, (req, res) => {
    try {
        const manifest = buildManifestFromForm(req.body || {});
        writeManifest(manifest);
        res.json({ success: true, manifest });
    } catch (error) {
        console.error('Manifest creation failed:', error);
        res.status(500).json({ error: 'Failed to create manifest.' });
    }
});

app.post('/api/modpacks/import-modrinth', requireAdmin, upload.single('file'), async (req, res) => {
    const uploadedFile = req.file;
    if (!uploadedFile) {
        return res.status(400).json({ error: 'Upload a .mrpack file first.' });
    }

    try {
        const zip = new AdmZip(uploadedFile.path);
        const indexEntry = zip.getEntry('modrinth.index.json');
        if (!indexEntry) {
            return res.status(400).json({ error: 'The uploaded archive is not a valid Modrinth pack.' });
        }

        const index = JSON.parse(indexEntry.getData().toString('utf8'));
        const baseId = sanitizeSlug(index.name || path.basename(uploadedFile.originalname, path.extname(uploadedFile.originalname)));
        let importId = baseId;
        let suffix = 1;
        while (fs.existsSync(path.join(MANIFESTS_DIR, `${importId}.json`))) {
            importId = `${baseId}-${suffix++}`;
        }

        ensureDir(path.join(MODPACKS_DIR, 'imports', importId));

        const loaderInfo = resolveLoaderFromIndex(index);
        const modrinthFiles = (index.files || []).map((entry) => {
            const hashInfo = hashEntry(entry);
            return {
                path: entry.path,
                downloadUrl: entry.downloads && entry.downloads.length > 0 ? entry.downloads[0] : '',
                hash: hashInfo.hash,
                hashAlgorithm: hashInfo.hashAlgorithm
            };
        }).filter((entry) => entry.path && entry.downloadUrl);

        const overrideFiles = extractModrinthOverrides(zip, importId);
        const manifest = {
            id: importId,
            name: index.name || importId,
            version: index.versionId || '1.0.0',
            minecraftVersion: index.dependencies?.minecraft || 'latest',
            modLoader: loaderInfo.modLoader,
            modLoaderVersion: loaderInfo.modLoaderVersion,
            description: index.summary || index.name || 'Imported Modrinth pack.',
            coverImage: '',
            author: index.name || 'Modrinth',
            mods: [],
            files: [...modrinthFiles, ...overrideFiles],
            createdAt: new Date().toISOString(),
            source: 'modrinth',
            isOfficial: true,
            modrinth: {
                slug: index.name || importId,
                dependencies: index.dependencies || {}
            }
        };

        writeManifest(manifest);
        res.json({ success: true, manifest });
    } catch (error) {
        console.error('Modrinth import failed:', error);
        res.status(500).json({ error: error.message || 'Failed to import the Modrinth pack.' });
    } finally {
        if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) {
            fs.unlinkSync(uploadedFile.path);
        }
    }
});

app.post('/invite/resolve', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    try {
        ensureDir(MANIFESTS_DIR);
        if (!fs.existsSync(INVITES_FILE)) {
            writeJson(INVITES_FILE, {
                'VIP-PACK-2026': 'INVITE_vip_modpack'
            });
        }

        const invites = readJson(INVITES_FILE, {});
        const targetFilename = invites[code];
        if (targetFilename) {
            const filePath = path.join(MANIFESTS_DIR, `${targetFilename}.json`);
            if (fs.existsSync(filePath)) {
                const manifest = readJson(filePath, null);
                if (manifest) {
                    manifest.id = targetFilename;
                    return res.json({ success: true, manifest });
                }
            }
        }
    } catch (error) {
        console.error('Invite resolution failed:', error);
    }

    res.status(404).json({ error: 'Invalid or expired invite code.' });
});

ensureDir(MANIFESTS_DIR);
ensureDir(MODPACKS_DIR);
ensureDir(TMP_DIR);
if (!fs.existsSync(DB_FILE)) writeJson(DB_FILE, {});
if (!fs.existsSync(INVITES_FILE)) {
    writeJson(INVITES_FILE, {
        'VIP-PACK-2026': 'INVITE_vip_modpack'
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Minevanced server listening on port ${PORT}`);
    if (!ADMIN_PASSWORD) {
        console.warn('ADMIN_PASSWORD is not set. The dashboard login will be disabled until it is configured.');
    }
});
