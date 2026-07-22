const crypto = require('crypto');
const db = require('../db/connection');
const config = require('../config');

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function createUserSession(discordId) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + config.sessionExpiryHours * 3600000).toISOString();
    db.prepare('INSERT INTO user_sessions (token, discord_id, expires_at) VALUES (?, ?, ?)').run(
        token, discordId, expiresAt
    );
    return token;
}

function cleanupSessions() {
    db.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = header.slice(7);
    const session = db.prepare(
        "SELECT * FROM user_sessions WHERE token = ? AND expires_at > datetime('now')"
    ).get(token);

    if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(session.discord_id);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
}

function requireAdmin(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = header.slice(7);

    const session = db.prepare(
        "SELECT * FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')"
    ).get(token);

    if (!session) {
        return res.status(401).json({ error: 'Invalid or expired admin session' });
    }

    req.adminSession = session;
    next();
}

module.exports = { generateToken, hashPassword, createUserSession, cleanupSessions, requireAuth, requireAdmin };
