const express = require('express');
const router = express.Router();
const discord = require('../auth/discord');
const { isUsernamePremium } = require('../auth/premium');
const { generateToken, createUserSession, requireAuth } = require('../auth/middleware');
const db = require('../db/connection');

router.get('/discord/authorize', (req, res) => {
    const redirectUri = req.query.redirect || undefined;
    const url = discord.getAuthorizationUrl(redirectUri);
    res.json({ url });
});

router.post('/discord/callback', async (req, res) => {
    try {
        const { code, redirectUri } = req.body;
        if (!code) {
            return res.status(400).json({ error: 'Missing authorization code' });
        }

        const tokenData = await discord.exchangeCode(code, redirectUri);
        const discordUser = await discord.fetchUser(tokenData.access_token);

        let user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordUser.id);
        const needsUsername = !user || !user.mc_username;

        if (!user) {
            db.prepare(
                'INSERT INTO users (discord_id, discord_username, discord_avatar) VALUES (?, ?, ?)'
            ).run(discordUser.id, discordUser.username, discordUser.avatar);
            user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordUser.id);
        } else {
            db.prepare(
                "UPDATE users SET discord_username = ?, discord_avatar = ?, last_login = datetime('now') WHERE discord_id = ?"
            ).run(discordUser.username, discordUser.avatar, discordUser.id);
        }

        const sessionToken = createUserSession(discordUser.id);

        res.json({
            token: sessionToken,
            user: {
                discord_id: user.discord_id,
                discord_username: user.discord_username,
                discord_avatar: user.discord_avatar,
                mc_username: user.mc_username,
                is_admin: user.is_admin,
            },
            needsUsername,
        });
    } catch (err) {
        console.error('Discord callback error:', err.message);
        res.status(500).json({ error: 'Failed to complete Discord authentication' });
    }
});

router.post('/discord/username', requireAuth, async (req, res) => {
    try {
        const { username } = req.body;
        const user = req.user;

        if (user.mc_username) {
            return res.status(400).json({ error: 'Username already set. Contact an admin to change it.' });
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

        const existing = db.prepare('SELECT id FROM users WHERE mc_username = ?').get(trimmed);
        if (existing) {
            return res.status(409).json({ error: 'This username is already taken' });
        }

        const premium = await isUsernamePremium(trimmed);
        if (premium) {
            return res.status(409).json({ error: 'This username belongs to a premium Minecraft account and cannot be used' });
        }

        db.prepare('UPDATE users SET mc_username = ? WHERE discord_id = ?').run(trimmed, user.discord_id);
        db.prepare(
            'INSERT INTO username_history (user_id, old_username, new_username, changed_by) VALUES (?, ?, ?, ?)'
        ).run(user.id, null, trimmed, 'self');

        const updatedUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(user.discord_id);

        res.json({
            success: true,
            user: {
                discord_id: updatedUser.discord_id,
                discord_username: updatedUser.discord_username,
                discord_avatar: updatedUser.discord_avatar,
                mc_username: updatedUser.mc_username,
                is_admin: updatedUser.is_admin,
            },
        });
    } catch (err) {
        console.error('Username selection error:', err.message);
        res.status(500).json({ error: 'Failed to set username' });
    }
});

router.get('/me', requireAuth, (req, res) => {
    const user = req.user;
    res.json({
        user: {
            discord_id: user.discord_id,
            discord_username: user.discord_username,
            discord_avatar: user.discord_avatar,
            mc_username: user.mc_username,
            is_admin: user.is_admin,
        },
    });
});

module.exports = router;
