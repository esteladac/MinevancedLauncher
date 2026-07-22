const db = require('./connection');

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id      TEXT UNIQUE NOT NULL,
            discord_username TEXT NOT NULL,
            discord_avatar  TEXT,
            mc_username     TEXT UNIQUE,
            is_premium      INTEGER DEFAULT 0,
            is_admin        INTEGER DEFAULT 0,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            token           TEXT UNIQUE NOT NULL,
            discord_id      TEXT NOT NULL,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at      DATETIME NOT NULL,
            FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            token           TEXT UNIQUE NOT NULL,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at      DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS username_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
            old_username    TEXT,
            new_username    TEXT,
            changed_by      TEXT,
            changed_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
        CREATE INDEX IF NOT EXISTS idx_users_mc_username ON users(mc_username);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_discord ON user_sessions(discord_id);
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);

        CREATE TABLE IF NOT EXISTS bug_reports (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            type            TEXT NOT NULL,
            title           TEXT,
            description     TEXT,
            stack           TEXT,
            message         TEXT,
            platform        TEXT,
            arch            TEXT,
            nodeVersion     TEXT,
            electronVersion TEXT,
            appVersion      TEXT,
            mc_version      TEXT,
            modpack         TEXT,
            username        TEXT,
            client_logs     TEXT,
            status          TEXT DEFAULT 'new',
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_bug_reports_type ON bug_reports(type);
        CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
        CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at);
    `);
}

module.exports = { initSchema };
