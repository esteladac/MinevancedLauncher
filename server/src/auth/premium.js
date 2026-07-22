const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(username) {
    const entry = cache.get(username.toLowerCase());
    if (entry && Date.now() - entry.time < CACHE_TTL) {
        return entry.value;
    }
    cache.delete(username.toLowerCase());
    return undefined;
}

function setCache(username, value) {
    cache.set(username.toLowerCase(), { value, time: Date.now() });
}

async function isUsernamePremium(username) {
    const cached = getCached(username);
    if (cached !== undefined) return cached;

    try {
        const res = await fetch(
            `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`
        );

        if (res.ok) {
            setCache(username, true);
            return true;
        }

        setCache(username, false);
        return false;
    } catch {
        setCache(username, false);
        return false;
    }
}

module.exports = { isUsernamePremium };
