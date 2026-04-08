const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = 8080;
const DB_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(cors());

// Initialize dummy database if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2));
}

function loadUsers() {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

// Login Endpoint
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    const users = loadUsers();
    const user = users[username.toLowerCase()];

    if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
    }

    const hash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (user.passwordHash !== hash) {
        return res.status(401).json({ error: "Invalid username or password" });
    }

    // Success
    res.json({ success: true, username: username });
});

// Register Endpoint (for MinevancedAuth)
app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || username.length < 3 || password.length < 4) {
        return res.status(400).json({ error: "Invalid username or password criteria" });
    }

    const users = loadUsers();
    const normalizedUsername = username.toLowerCase();

    if (users[normalizedUsername]) {
        return res.status(400).json({ error: "Username already taken" });
    }

    users[normalizedUsername] = {
        passwordHash: crypto.createHash('sha256').update(password).digest('hex')
    };

    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true, message: "User registered successfully" });
});

// Serve Manifests Directory statically
const manifestsDir = path.join(__dirname, '..', 'manifests');
app.use('/manifests/files', express.static(manifestsDir));

// Serve Modpack Files (Mods, Configs, Assets) statically
const modpacksDir = path.join(__dirname, '..', 'modpacks');
if (!fs.existsSync(modpacksDir)) {
    fs.mkdirSync(modpacksDir, { recursive: true });
}
app.use('/modpacks', express.static(modpacksDir));

// Endpoint to list all available manifests (Modpacks)
app.get('/manifests', (req, res) => {
    let modpacks = [];
    if (fs.existsSync(manifestsDir)) {
        try {
            const files = fs.readdirSync(manifestsDir);
            files.forEach(file => {
                if (file.endsWith('.json') && !file.startsWith('INVITE_')) { // Regular manifests only
                    const content = fs.readFileSync(path.join(manifestsDir, file), 'utf8');
                    try {
                        const parsed = JSON.parse(content);
                        parsed.id = file.replace('.json', ''); // Set the ID from the filename
                        // Mark as official from server side
                        parsed.isOfficial = true;
                        modpacks.push(parsed);
                    } catch (jsonErr) {
                        console.error('Failed to parse manifest json:', file, jsonErr);
                    }
                }
            });
        } catch (e) {
            console.error('Failed reading manifests folder:', e);
            return res.status(500).json({ error: "Failed to read manifests" });
        }
    }
    res.json({ success: true, modpacks });
});

// Endpoint to resolve invite codes
const inviteCodesFile = path.join(__dirname, 'invites.json');
if (!fs.existsSync(inviteCodesFile)) {
    // Generate a dummy invite code linking to a dummy private manifest mapping
    fs.writeFileSync(inviteCodesFile, JSON.stringify({
        "VIP-PACK-2026": "INVITE_vip_modpack"
    }, null, 2));
}

app.post('/invite/resolve', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code required" });
    
    try {
        const invites = JSON.parse(fs.readFileSync(inviteCodesFile, 'utf8'));
        const targetFilename = invites[code];
        
        if (targetFilename) {
            const filePath = path.join(manifestsDir, `${targetFilename}.json`);
            if (fs.existsSync(filePath)) {
                const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                // The filename will be its id locally
                manifest.id = targetFilename; 
                return res.json({ success: true, manifest });
            }
        }
    } catch(e) {}
    
    res.status(404).json({ error: "Invalid or expired invite code." });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`MinevancedAuth API listening on port ${PORT}`);
});