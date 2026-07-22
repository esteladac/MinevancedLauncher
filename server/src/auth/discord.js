const config = require('../config');

const DISCORD_API = 'https://discord.com/api/v10';

function getAuthorizationUrl(redirectUri) {
    const redirect = redirectUri || config.discord.redirectUri;
    const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'identify',
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code, redirectUri) {
    const redirect = redirectUri || config.discord.redirectUri;
    const params = new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirect,
    });

    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Discord token exchange failed (${res.status}): ${body}`);
    }

    return res.json();
}

async function fetchUser(accessToken) {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Discord user fetch failed (${res.status}): ${body}`);
    }

    return res.json();
}

module.exports = { getAuthorizationUrl, exchangeCode, fetchUser };
