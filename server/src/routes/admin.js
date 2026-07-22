const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { generateToken, hashPassword, requireAdmin } = require('../auth/middleware');
const config = require('../config');
const { isUsernamePremium } = require('../auth/premium');

router.post('/login', (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: 'Password required' });
    }

    const hash = hashPassword(password);
    if (hash !== config.adminPasswordHash) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + config.adminSessionExpiryHours * 3600000).toISOString();
    db.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);

    res.json({ token });
});

router.get('/stats', requireAdmin, (req, res) => {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const premiumCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_premium = 1').get().count;
    const recentSignups = db.prepare(
        "SELECT COUNT(*) as count FROM users WHERE created_at > datetime('now', '-7 days')"
    ).get().count;
    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get().count;
    const totalBugs = db.prepare('SELECT COUNT(*) as count FROM bug_reports').get().count;
    const recentBugs = db.prepare(
        "SELECT COUNT(*) as count FROM bug_reports WHERE created_at > datetime('now', '-7 days')"
    ).get().count;

    res.json({ totalUsers, premiumCount, recentSignups, adminCount, totalBugs, recentBugs });
});

router.get('/users', requireAdmin, (req, res) => {
    const search = req.query.search || '';
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let whereClause = '';
    let params = [];

    if (search) {
        whereClause = 'WHERE mc_username LIKE ? OR discord_username LIKE ? OR discord_id LIKE ?';
        const like = `%${search}%`;
        params = [like, like, like];
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`).get(...params).count;
    const users = db.prepare(
        `SELECT * FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
        users: users.map(u => ({
            id: u.id,
            discord_id: u.discord_id,
            discord_username: u.discord_username,
            discord_avatar: u.discord_avatar,
            mc_username: u.mc_username,
            is_premium: u.is_premium,
            is_admin: u.is_admin,
            created_at: u.created_at,
            last_login: u.last_login,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    });
});

router.get('/users/:id', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const history = db.prepare(
        'SELECT * FROM username_history WHERE user_id = ? ORDER BY changed_at DESC'
    ).all(user.id);

    res.json({
        user: {
            id: user.id,
            discord_id: user.discord_id,
            discord_username: user.discord_username,
            discord_avatar: user.discord_avatar,
            mc_username: user.mc_username,
            is_premium: user.is_premium,
            is_admin: user.is_admin,
            created_at: user.created_at,
            last_login: user.last_login,
        },
        usernameHistory: history,
    });
});

router.put('/users/:id/username', requireAdmin, async (req, res) => {
    const { username } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
    }

    const trimmed = username.trim();

    if (trimmed.length < 3 || trimmed.length > 16) {
        return res.status(400).json({ error: 'Username must be 3-16 characters' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE mc_username = ? AND id != ?').get(trimmed, user.id);
    if (existing) {
        return res.status(409).json({ error: 'This username is already taken' });
    }

    const premium = await isUsernamePremium(trimmed);
    if (premium) {
        return res.status(409).json({ error: 'This username belongs to a premium Minecraft account' });
    }

    db.prepare('UPDATE users SET mc_username = ? WHERE id = ?').run(trimmed, user.id);
    db.prepare(
        'INSERT INTO username_history (user_id, old_username, new_username, changed_by) VALUES (?, ?, ?, ?)'
    ).run(user.id, user.mc_username, trimmed, 'admin');

    res.json({ success: true, mc_username: trimmed });
});

router.put('/users/:id/discord', requireAdmin, (req, res) => {
    const { discordId, discordUsername } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (!discordId) {
        return res.status(400).json({ error: 'Discord ID is required' });
    }

    const conflict = db.prepare('SELECT id FROM users WHERE discord_id = ? AND id != ?').get(discordId, user.id);
    if (conflict) {
        return res.status(409).json({ error: 'This Discord account is already linked to another user' });
    }

    db.prepare('UPDATE users SET discord_id = ?, discord_username = ? WHERE id = ?').run(
        discordId, discordUsername || user.discord_username, user.id
    );

    // Invalidate old sessions
    db.prepare('DELETE FROM user_sessions WHERE discord_id = ?').run(user.discord_id);

    res.json({ success: true });
});

router.put('/users/:id/premium', requireAdmin, (req, res) => {
    const { isPremium } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.prepare('UPDATE users SET is_premium = ? WHERE id = ?').run(isPremium ? 1 : 0, user.id);
    res.json({ success: true, is_premium: isPremium ? 1 : 0 });
});

router.put('/users/:id/admin', requireAdmin, (req, res) => {
    const { isAdmin } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, user.id);
    res.json({ success: true, is_admin: isAdmin ? 1 : 0 });
});

router.delete('/users/:id', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    db.prepare('DELETE FROM user_sessions WHERE discord_id = ?').run(user.discord_id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    res.json({ success: true });
});

module.exports = router;
