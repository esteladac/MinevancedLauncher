const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
    port: parseInt(process.env.PORT || '8080', 10),
    discord: {
        clientId: process.env.DISCORD_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        redirectUri: process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1:29347/discord-callback',
    },
    serverUrl: process.env.SERVER_URL || 'http://localhost:8080',
    adminPasswordHash: process.env.ADMIN_PASSWORD
        ? crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')
        : '',
    sessionExpiryHours: parseInt(process.env.SESSION_EXPIRY_HOURS || '72', 10),
    adminSessionExpiryHours: parseInt(process.env.ADMIN_SESSION_EXPIRY_HOURS || '24', 10),
    dbPath: path.join(__dirname, '..', 'data', 'minevanced.db'),
};

module.exports = config;
