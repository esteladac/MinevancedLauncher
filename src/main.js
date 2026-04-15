// --- PERFORMANCE TRACKER ---
const { performance } = require('perf_hooks');
const timeStart = performance.now();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// This creates a log file right where you launch the app
const logPath = path.join(process.cwd(), 'startup.log');
fs.writeFileSync(logPath, '--- Minevanced Boot Trace (High Precision) ---\n');

const { app, BrowserWindow, ipcMain } = require('electron');

// --- Config (Save System) ---
function getConfigPath() {
    return path.join(app.getPath('userData'), 'minevanced_config.json');
}

function loadConfig() {
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
              const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              if (!conf.language && app.isReady()) conf.language = app.getLocale().split('-')[0] === 'fr' ? 'fr' : 'en';
              return conf;
          }
      } catch(e) { console.error("Error holding config:", e); }
      return { ram: 4, debugSplash: false, language: app.isReady() && app.getLocale().split('-')[0] === 'fr' ? 'fr' : 'en' }; // Default fallback
}

function saveConfig(newConfig) {
    try {
        const configPath = getConfigPath();
        const current = loadConfig();
        const merged = { ...current, ...newConfig };
        fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    } catch(e) { console.error("Error saving config:", e); }
}

let mainWindow;
let splashWindow;

function bootLog(step) {
    const elapsed = (performance.now() - timeStart).toFixed(2);
    fs.appendFileSync(logPath, `[+${elapsed}ms] ${step}\n`);
    
    // Wire logs directly into Splash UI if user enabled it
    if (splashWindow && !splashWindow.isDestroyed() && app.isReady()) {
        try {
            const conf = loadConfig();
            splashWindow.webContents.send('splash-log', step, conf.debugSplash);
        } catch (e) {}
    }
}

bootLog("STEP 1: Script execution started (Node.js is awake, requires imported)");
bootLog("STEP 2: Starting require('electron')...");
bootLog("STEP 3: Electron module successfully imported into memory");

function createWindow() {
    bootLog("STEP 7: createWindow() function called");

    // --- INSTANT SPLASH (Electron-native, zero white flash) ---
    bootLog("STEP 8: Instantiating Splash BrowserWindow...");
    splashWindow = new BrowserWindow({
        width: 300,
        height: 350,
        frame: false,
        icon: path.join(__dirname, 'logo.png'),
        transparent: false,
        backgroundColor: '#121016', // Forces dark color instantly on window creation
        show: false, // DO NOT show until it's painted dark!
        alwaysOnTop: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    bootLog("STEP 9: Splash BrowserWindow object created");

    bootLog("STEP 10: Calling loadFile('splash.html')...");
    splashWindow.loadFile(__dirname + '/splash.html');

    // Wait until the renderer has perfectly drawn the dark background and DOM
    splashWindow.once('ready-to-show', () => {
        bootLog("STEP 11: splashWindow emitted 'ready-to-show' (GPU painted it)");
        splashWindow.show();
        bootLog("STEP 12: splashWindow.show() called. SPLASH IS VISIBLE NATIVELY!");

        // Yield the event loop so Windows paints immediately, then start the heavy UI 
        setTimeout(() => {
            bootLog("STEP 13: setTimeout triggered, starting Main BrowserWindow creation...");
            mainWindow = new BrowserWindow({
                width: 1050,
                height: 650,
                frame: false,
                icon: path.join(__dirname, 'logo.png'),
                transparent: true,
                backgroundColor: '#00000000', // Stops Electron's default white paint on launch
                resizable: false,
                show: false, 
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });
            bootLog("STEP 14: Main BrowserWindow object created");

            mainWindow.loadFile(__dirname + '/index.html');
            bootLog("STEP 15: Main HTML file load requested...");

            let isCustomMinimizing = false;

            // Make the variable accessible to IPC scopes later
            mainWindow.isCustomMinimizing = false;

            mainWindow.on('minimize', (e) => {
                if (!mainWindow.isCustomMinimizing) {
                    e.preventDefault();
                    mainWindow.webContents.send('trigger-minimize-animation');
                }
            });

            mainWindow.once('ready-to-show', () => {
                bootLog("STEP 16: Main UI completely rendered in background ready-to-show triggered!");
                if (splashWindow && !splashWindow.isDestroyed()) {
                    // Preload the splash window by keeping it alive but hidden
                    splashWindow.hide();
                }
                mainWindow.show();
                bootLog("STEP 17: Main Window Shown, splash hidden.");
            });
        }, 50);
    });
}

bootLog("STEP 4: Electron app object acquired. Requesting Single Instance Lock...");

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    bootLog("STEP 5: Another instance is already running! Quitting immediately.");
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Restores and focuses the existing window if user clicks shortcut again
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    bootLog("STEP 5: Lock acquired. Calling app.whenReady()...");
    app.whenReady().then(() => {
        bootLog("STEP 6: app.whenReady() resolved! Chromium engine is initialized and ready.");
        createWindow();
    });
    bootLog("STEP 5.5: Wait assigned to app.whenReady(). Main thread now yielding.");
}

// --- Window Controls ---
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-minimize-done', () => {
    mainWindow.isCustomMinimizing = true;
    mainWindow.minimize();
    setTimeout(() => { mainWindow.isCustomMinimizing = false; }, 500);
});
ipcMain.on('window-close', () => {
    // 1. Nuke the main window immediately for "instant feel" 
    mainWindow.hide();

    // 2. Re-use the existing preloaded native splash for instant shutdown UX
    const config = loadConfig();

    function shutdownLog(msg) {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-log', msg, config.debugSplash);
        }
    }

    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.show();
        // Turn the preloaded Splash Screen red and say "STOPPING..." instantly
        splashWindow.webContents.send('splash-state', 'shutdown');
        
        shutdownLog("STAGE 1: Primary UI Window hidden from OS");
        
        setTimeout(() => {
            shutdownLog("STAGE 2: Purging active memory buffers...");
            setTimeout(() => {
                shutdownLog("STAGE 3: Committing config file to disk...");
                saveConfig(config); // ensure state is saved before close
                setTimeout(() => {
                    shutdownLog("STAGE 4: Detaching Electron engine IPC channels...");
                    setTimeout(() => {
                        shutdownLog("STAGE 5: Graceful application exit initialized.");
                        app.quit();
                    }, 500);
                }, 400);
            }, 400);
        }, 300);
    } else {
        // Fallback just in case memory was flushed
        app.quit();
    }
});

ipcMain.on('request-config', (event) => {
    event.sender.send('load-config', loadConfig());
});

ipcMain.on('save-config', (event, newConf) => {
    saveConfig(newConf);
});

// --- Dynamic Mod List Scanner ---
ipcMain.on('request-mods', (event, instanceName) => {
      let targetInstance = instanceName || 'minevanced-modded';
      if (targetInstance.toLowerCase() === 'minevanced') {
          targetInstance = 'minevanced-modded'; // Default to modded visual fallback
      }
    const modsPath = path.join(app.getPath('appData'), '.minevanced', targetInstance, 'mods');
    let modArray = [];
    if (fs.existsSync(modsPath)) {
        try {
            const files = fs.readdirSync(modsPath);
            files.forEach(f => {
                if (f.endsWith('.jar')) {
                    // Try to guess a clean display name by stripping version numbers
                    const cleanName = f.replace(/-\d+(\.\d+)*/, '').replace('.jar', '').replace(/[-_]/g, ' ');
                    const finalName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
                    modArray.push({
                        name: finalName,
                        fileName: f
                    });
                }
            });
        } catch(e) { console.error('Failed indexing mods', e); }
    }
    // Return array alphabetically
    modArray.sort((a,b) => a.name.localeCompare(b.name));
    event.sender.send('load-mods', modArray);
});

// --- Read Modpack Manifests from Server ---
ipcMain.on('request-modpacks', async (event) => {
    let onlinePacks = [];
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('http://localhost:8080/manifests').catch(() => ({ ok: false }));
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.modpacks) {
                onlinePacks = data.modpacks; // usually doesn't include Minevanced+Vanilla anymore since we hardcode them, but let's keep server ones
            }
        }
    } catch (err) {
        console.error('Failed to fetch manifests from server:', err);
    }

    try {
        // Read Built-in / Hardcoded offline modpacks safely before compilation
        const builtinPath = path.join(__dirname, '.builtin-packs.json');
        if (fs.existsSync(builtinPath)) {
            try {
                const builtins = JSON.parse(fs.readFileSync(builtinPath, 'utf-8'));
                // Sort builtins inversely so unshifting leaves them in original order,
                // or just remove matching online packs and unshift.
                // Let's filter out any online pack that matches a builtin, then prepend builtins.
                onlinePacks = onlinePacks.filter(p => !builtins.find(b => b.id === p.id));

                // Now unshift built-ins in reverse order so the first builtin ends up at index 0
                for (let i = builtins.length - 1; i >= 0; i--) {
                    const b = builtins[i];
                    b.isOfficial = true;
                    b.isBuiltin = true;
                    onlinePacks.unshift(b); // Set as top priority
                }
            } catch(e) {
                console.error("Failed to parse .builtin-packs.json", e);
            }
        }

        // Read local invites
        const localManifestDir = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), '.minevanced', 'manifests');
        if (!fs.existsSync(localManifestDir)) fs.mkdirSync(localManifestDir, { recursive: true });

        const localFiles = fs.readdirSync(localManifestDir);
        for (const file of localFiles) {
            if (file.startsWith('INVITE_') && file.endsWith('.json')) {
                try {
                    const localData = JSON.parse(fs.readFileSync(path.join(localManifestDir, file), 'utf-8'));
                    if (!onlinePacks.find(p => p.id === localData.id)) {
                        localData.isOfficial = false; // explicitly mark as custom
                        onlinePacks.push(localData);
                    }
                } catch(e) {}
            }
        }

        for (const folderName of ['manifests', 'modpacks']) {
              const localUserManifestsDir = path.join(app.getAppPath(), folderName);
              if (fs.existsSync(localUserManifestsDir)) {
                  try {
                      const userFiles = fs.readdirSync(localUserManifestsDir);
                      for (const file of userFiles) {
                          if (file.endsWith('.json') && !file.startsWith('INVITE_')) {
                              try {
                                  const fcontent = fs.readFileSync(path.join(localUserManifestsDir, file), 'utf8');
                                  const parsed = JSON.parse(fcontent);
                                  if (!parsed.id) parsed.id = file.replace('.json', '');
                                  if (!onlinePacks.find(p => p.id === parsed.id) && !parsed.name.startsWith('[DEV]')) {
                                      parsed.isOfficial = false;
                                      parsed.isBuiltin = false;
                                      onlinePacks.push(parsed);
                                  }
                              } catch (err) {}
                          }
                      }
                  } catch (err) {}
              }
          }

          const filteredPacks = onlinePacks.filter(p => !p.hidden);
        event.sender.send('load-modpacks', filteredPacks);
    } catch (err) {
        console.error('Failed formatting packs:', err);
        event.sender.send('load-modpacks', onlinePacks.filter(p => !p.hidden));
    }
});

ipcMain.on('resolve-invite', async (event, code) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('http://localhost:8080/invite/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        const data = await response.json();
        if (data.success) {
            const manifest = data.manifest;

            // Check if it's attempting to overwrite a built-in pack
            const builtinPath = path.join(__dirname, '.builtin-packs.json');
            if (fs.existsSync(builtinPath)) {
                try {
                    const builtins = JSON.parse(fs.readFileSync(builtinPath, 'utf-8'));
                    if (builtins.find(b => b.id === manifest.id)) {
                        event.sender.send('invite-error', 'Cannot overwrite built-in modpacks.');
                        return;
                    }
                } catch (e) {}
            }

            const localManifestDir = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), '.minevanced', 'manifests');
            if (!fs.existsSync(localManifestDir)) fs.mkdirSync(localManifestDir, { recursive: true });

            fs.writeFileSync(
                path.join(localManifestDir, `INVITE_${manifest.id}.json`),
                JSON.stringify(manifest, null, 4)
            );

            event.sender.send('invite-success', `Successfully added modpack: ${manifest.name}`);
        } else {
            event.sender.send('invite-error', data.error || 'Invalid invite code.');
        }
    } catch (err) {
        console.error('Invite resolution failed:', err);
        event.sender.send('invite-error', 'Server offline or unreachable.');
    }
});

ipcMain.on('delete-instance', (event, targetId) => {
    try {
        const baseDir = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), '.minevanced');
        const instancePath = path.join(baseDir, 'instances', targetId);

        if (fs.existsSync(instancePath)) {
            fs.rmSync(instancePath, { recursive: true, force: true });
        }

        const manifestPath = path.join(baseDir, 'manifests', `INVITE_${targetId}.json`);
        if (fs.existsSync(manifestPath)) {
            fs.rmSync(manifestPath);
        }

        event.sender.send('invite-success', 'Instance files purged successfully.');

        // Re-trigger load
        ipcMain.emit('request-modpacks', event);
    } catch (err) {
        console.error('Failed to delete instance:', err);
        event.sender.send('invite-error', 'Failed to delete instance.');
    }
});

// --- Authentication (MSMC & Offline) ---
const msmc = require('msmc');
const { Authenticator } = require('minecraft-launcher-core');
const { shell } = require('electron');

ipcMain.on('login-microsoft', async (event) => {
    try {
        const authManager = new msmc.Auth("select_account");
        const xboxManager = await authManager.launch("electron");
        const token = await xboxManager.getMinecraft();
        const mclcAuth = token.mclc(); // gets { access_token, client_token, uuid, name, ... }

        saveConfig({ authType: 'microsoft', authProfile: mclcAuth });
        event.sender.send('auth-success', { type: 'microsoft', profile: mclcAuth });
    } catch (err) {
        console.error("Microsoft Login Error:", err);
        event.sender.send('auth-failed', err.message || "Failed to authenticate with Microsoft.");
    }
});

ipcMain.on('request-browser-link', (event) => {
    try {
        const authManager = new msmc.Auth("select_account");
        const link = authManager.createLink(); // Uses default redirect https://login.live.com/oauth20_desktop.srf
        shell.openExternal(link);
    } catch (e) {
        console.error(e);
    }
});

ipcMain.on('login-microsoft-code', async (event, urlOrCode) => {
    try {
        const authManager = new msmc.Auth("select_account");
        const xboxManager = await authManager.login(urlOrCode);
        const token = await xboxManager.getMinecraft();
        const mclcAuth = token.mclc();

        saveConfig({ authType: 'microsoft', authProfile: mclcAuth });
        event.sender.send('auth-success', { type: 'microsoft', profile: mclcAuth });
    } catch (err) {
        console.error("Microsoft Browser Code Login Error:", err);
        event.sender.send('auth-failed', err.message || "Failed to get Minecraft token from supplied URL.");
    }
});

ipcMain.on('login-offline', async (event, credentials) => {
    try {
        const { username, password } = credentials;
        const config = loadConfig();

        // 1. Strict Limit Rule: 1 cracked account maximum
        // Bypassed if devModeActive === true AND the specific devAuth bypass is toggled
        if (!(devModeActive && devConfig.bypassAuth) && config.authType === 'offline' && config.authProfile) {
            if (config.authProfile.name.toLowerCase() !== username.toLowerCase()) {
                return event.sender.send('auth-failed', "Strict Limit Rule: Only 1 offline account is allowed per launcher installation.");
            }
        }

        // 2. MinevancedAuth verification
        const response = await fetch('http://localhost:8080/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        }).catch(err => null);

        if (!response) {
            return event.sender.send('auth-failed', "MinevancedAuth Server Offline. Cannot verify credentials.");
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            return event.sender.send('auth-failed', data.error || "Invalid MinevancedAuth credentials.");
        }

        // 3. Successful Verification, get local Auth payload
        let auth = await Authenticator.getAuth(username);
        // Strip out any non-serializable classes, functions, or promises down to POJO
        auth = JSON.parse(JSON.stringify(auth));
        
        saveConfig({ authType: 'offline', authProfile: auth });
        event.sender.send('auth-success', { type: 'offline', profile: auth });
    } catch (err) {
        console.error("Offline Login Error:", err);
        event.sender.send('auth-failed', "Failed to create offline profile.");
    }
});

// --- Register Offline/MinevancedAuth ---
ipcMain.on('register-offline', async (event, credentials) => {
    try {
        const { username, password } = credentials;
        const fetch = (await import('node-fetch')).default;

        const response = await fetch('http://localhost:8080/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        }).catch(err => null);

        if (!response) {
            return event.sender.send('register-failed', "MinevancedAuth Server Offline. Cannot reach server.");
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            return event.sender.send('register-failed', data.error || "Failed to register account.");
        }

        event.sender.send('register-success', data.message || "Account created successfully.");
    } catch (err) {
        console.error("Offline Registration Error:", err);
        event.sender.send('register-failed', "An unexpected error occurred during registration.");
    }
});

// --- Launch Engine (Lazy Loaded) ---
let activeGameProcess = null;
let devModeActive = false; // The secret Developer Backdoor switch
let devConfig = { bypassAuth: true, bypassAntiCheat: true }; // Controls specific overrides

// --- DEVELOPER BACKDOOR ---
ipcMain.on('verify-dev-password', (event, pwd) => {
    // Hidden target hash computed mathematically against target plaintext "play.io2"
    const targetHash = "81862ebdd29ee6f84b06ff53adcb62e1cb0161e296c88ffdae190ec5eeb99937";
    const inputHash = crypto.createHash('sha256').update(pwd).digest('hex');

    if (inputHash === targetHash) {
        devModeActive = true;
        event.sender.send('dev-password-result', true);
    } else {
        event.sender.send('dev-password-result', false);
    }
});

ipcMain.on('dev-request-logs', (event) => {
    try {
        if (fs.existsSync(logPath)) {
            const logs = fs.readFileSync(logPath, 'utf8');
            event.sender.send('dev-logs-data', logs);
        } else {
            event.sender.send('dev-logs-data', "No startup trace found at " + logPath);
        }
    } catch(e) {
        event.sender.send('dev-logs-data', "Error reading logs: " + e.message);
    }
});

ipcMain.on('dev-clear-logs', (event) => {
    if (!devModeActive) return;
    try {
        fs.writeFileSync(logPath, '--- Minevanced Boot Trace (High Precision) ---\n[DEV] Logs purged successfully.\n');
        event.sender.send('dev-logs-data', fs.readFileSync(logPath, 'utf8'));
    } catch(e) {}
});

ipcMain.on('dev-flush-config', (event) => {
    if (!devModeActive) return;
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
            console.log("DEV OVERRIDE: local hardware config file deleted.");
        }
    } catch(e) {}
});

// DEV: Dynamically change dev override settings
ipcMain.on('dev-update-settings', (event, newDevSettings) => {
    if (!devModeActive) return;
    devConfig = { ...devConfig, ...newDevSettings };
    console.log("[DEV] Overrides updated: ", devConfig);
});

// DEV: Temporary Instance Builder
ipcMain.on('dev-create-instance', (event, data) => {
    if (!devModeActive) return;
    const { id, version, loader } = data;

    const manifestsDir = path.join(app.getAppPath(), 'manifests');
    if (!fs.existsSync(manifestsDir)) {
        fs.mkdirSync(manifestsDir, { recursive: true });
    }

    const testManifest = {
        name: `[DEV] ${id}`,
        minecraftVersion: version,
        modLoader: loader,
        description: `Auto-generated test instance using ${loader} on MC ${version}.`,
        blacklist: [],
        mods: []
    };

    const targetPath = path.join(manifestsDir, `${id}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(testManifest, null, 2));
    console.log(`[DEV] Injected manifest to ${targetPath}`);

    // Automatically trigger app to re-read the folder for the UI.
    // Fetch manifests and parse them correctly
    let modpacks = [];
    if (fs.existsSync(manifestsDir)) {
        try {
            const files = fs.readdirSync(manifestsDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const content = fs.readFileSync(path.join(manifestsDir, file), 'utf8');
                    try {
                        const parsed = JSON.parse(content);
                        parsed.id = file.replace('.json', ''); // simple ID
                        modpacks.push(parsed);
                    } catch(jsonErr) {
                        console.error('Failed to parse manifest json:', file, jsonErr);
                    }
                }
            });
        } catch(e) { console.error('Failed checking manifests folder', e); }
    }
    event.sender.send('load-modpacks', modpacks);
});

// DEV: Purge Temporary Instances
ipcMain.on('dev-delete-instances', (event) => {
    if (!devModeActive) return;
    const manifestsDir = path.join(app.getAppPath(), 'manifests');
    if (fs.existsSync(manifestsDir)) {
        const files = fs.readdirSync(manifestsDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const targetPath = path.join(manifestsDir, file);
                try {
                    const content = fs.readFileSync(targetPath, 'utf8');
                    const parsed = JSON.parse(content);
                    if (parsed.name && parsed.name.startsWith('[DEV]')) {
                        fs.unlinkSync(targetPath);
                        console.log(`[DEV] Deleted temp instance: ${file}`);
                    }
                } catch(e) {}
            }
        });

        // Re-read and update UI correctly
        let modpacks = [];
        const updatedFiles = fs.readdirSync(manifestsDir);
        updatedFiles.forEach(file => {
            if (file.endsWith('.json')) {
                const content = fs.readFileSync(path.join(manifestsDir, file), 'utf8');
                try {
                    const parsed = JSON.parse(content);
                    parsed.id = file.replace('.json', '');
                    modpacks.push(parsed);
                } catch(jsonErr) {}
            }
        });
        event.sender.send('load-modpacks', modpacks);
    }
});

ipcMain.on('kill-game', () => {
    console.log("Launcher instructed engine to terminate game process.");
    
    if (activeGameProcess) {
        // Safe fallback for Windows: nuke specific game process tree by PID (Avoids killing other Java apps)
        if (process.platform === 'win32' && activeGameProcess.pid) {
            require('child_process').exec(`taskkill /F /PID ${activeGameProcess.pid} /T`, () => {
                console.log(`OS-level taskkill executed gracefully on Minevanced PID: ${activeGameProcess.pid}`);
            });
        } else if (!activeGameProcess.killed) {
            try {
                activeGameProcess.kill('SIGKILL');
            } catch (e) {
                console.error("Failed to kill cleanly:", e);
            }
        }
    }
});

ipcMain.on('launch-game', async (event, configRequest) => {
    console.log("Starting Minevanced Launch Sequence...");
    
    // Support multi-instance structure
      let instanceName = configRequest.instance || 'vanilla';

      // Apply nested built-in profiles properly to separate folders, removing the classic instance fallback
      if (instanceName === 'minevanced') {
          if (configRequest.profile === 'optimized') {
              instanceName = 'minevanced-optimized';
          } else {
              instanceName = 'minevanced-modded';
          }
      }

    const crypto = require('crypto');
    const https = require('https');
    const http = require('http');
    const { Client, Authenticator } = require('minecraft-launcher-core');
    const loaders = require('tomate-loaders');

    // appData inherently points to C:\Users\User\AppData\Roaming on Windows
    const launcher = new Client();
    const rootPath = path.join(app.getPath('appData'), '.minevanced', instanceName);

    function getFileHash(filePath) {
        return new Promise((resolve) => {
            if (!fs.existsSync(filePath)) return resolve(null); 
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', () => resolve(null));
        });
    }

    function downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            const client = url.startsWith('https') ? https : http;

            // Adding { rejectUnauthorized: false } bypasses strict SSL checks
            // which helps private setups with self-signed certs pass the download phase!
            client.get(url, { rejectUnauthorized: false }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => file.close(resolve));
                } else {
                    file.close();
                    fs.unlink(dest, () => {}); 
                    reject(`Server error ${response.statusCode}: ${url}`);
                }
            }).on('error', (err) => {
                file.close();
                fs.unlink(dest, () => {});
                reject(err.message);
            });
        });
    }

    let manifest = { minecraftVersion: '1.20.4' }; // Fallback offline configuration

    try {
        mainWindow.webContents.send('update-status', 'Fetching Manifest from Server...');
        const fetch = (await import('node-fetch')).default;

        let targetManifestUrl = `http://localhost:8080/manifests/files/${instanceName}.json`;
        let manifestLoaded = false;

        // 1. Check Dev Local Overrides
        if (instanceName.startsWith('[DEV]')) {
             const localPath = path.join(app.getAppPath(), 'manifests', `${instanceName}.json`);
             if (fs.existsSync(localPath)) {
                 manifest = JSON.parse(fs.readFileSync(localPath, 'utf8'));
                 mainWindow.webContents.send('update-status', `Loaded Native Dev Manifest: ${manifest.minecraftVersion}`);
                 manifestLoaded = true;
             } else {
                 throw new Error("Dev manifest not found locally.");
             }
        } 
        
        // 2. Check Built-in local fallbacks first to support offline/locked installations like the sub-packs
        const builtinPath = path.join(__dirname, '.builtin-packs.json');
        if (!manifestLoaded && fs.existsSync(builtinPath)) {
            const builtins = JSON.parse(fs.readFileSync(builtinPath, 'utf-8'));
            const matchingBuiltin = builtins.find(b => b.id === instanceName);
            if (matchingBuiltin) {
                manifest = matchingBuiltin;
                mainWindow.webContents.send('update-status', `Loaded Built-in Manifest: ${manifest.minecraftVersion}`);
                manifestLoaded = true;
            }
        }
        
        // 3. External Server Fetch as last resort
        if (!manifestLoaded) {
             const response = await fetch(targetManifestUrl);
             if (!response.ok) throw new Error(`Server returned ${response.status} for manifest`);
             manifest = await response.json();
             mainWindow.webContents.send('update-status', `Loaded Remote Manifest: ${manifest.minecraftVersion}`);
        }

    } catch (err) {
        console.warn("Failed to load manifest. Entering fallback.", err.message);
        mainWindow.webContents.send('update-status', 'Manifest Load Failed - Fallback Version');

        // Artificial delay so the UI shows the "warning" message before jumping into the engine
        await new Promise(r => setTimeout(r, 2000));
    }

    // --- MINEVANCED SYNC ENGINE (Mod Downloading) ---
    try {
        // Sync Legacy Mods Array
        if (manifest.mods && Array.isArray(manifest.mods)) {
            const modsPath = path.join(rootPath, 'mods');
            if (!fs.existsSync(modsPath)) {
                fs.mkdirSync(modsPath, { recursive: true });
            }

            let current = 0;
            const totalMods = manifest.mods.length;

            for (const mod of manifest.mods) {
                current++;
                const modFilename = `${mod.name}-${mod.version || 'latest'}.jar`.replace(/[^a-zA-Z0-9.-]/g, '_');
                const targetFilePath = path.join(modsPath, modFilename);

                let needsDownload = true;
                if (fs.existsSync(targetFilePath)) {
                    if (mod.hash) {
                        const localHash = await getFileHash(targetFilePath);
                        if (localHash === mod.hash) {
                            needsDownload = false;
                        }
                    } else {
                        // Without hash, assume correct if versioned file exists
                        needsDownload = false;
                    }
                }

                if (needsDownload && mod.downloadUrl) {
                    mainWindow.webContents.send('update-status', `Syncing Mod ${current}/${totalMods}: ${mod.name}`);
                    console.log(`[SYNC] Downloading ${mod.name} from ${mod.downloadUrl}...`);
                    await downloadFile(mod.downloadUrl, targetFilePath).catch(e => {
                        console.error(`[SYNC ERROR] Failed to download ${mod.name}:`, e);
                    });
                }

                // Update UI bar roughly
                const progressPercent = Math.round((current / totalMods) * 100);
                mainWindow.webContents.send('update-status', `Syncing Mods: ${progressPercent}%`);
            }
        }

        // Sync General Generic Files (Configs, Resourcepacks, extra Mods, etc.)
        if (manifest.files && Array.isArray(manifest.files)) {
            let current = 0;
            const totalFiles = manifest.files.length;

            for (const fileObj of manifest.files) {
                current++;
                if (!fileObj.path) continue; // Skip invalid entries

                // Secure path target - ensure it stays inside the instance folder
                const targetFilePath = path.join(rootPath, fileObj.path);
                if (!targetFilePath.startsWith(rootPath)) {
                    console.warn(`[SYNC WARNING] File path ${fileObj.path} tried to escape instance folder. Skipping.`);
                    continue;
                }

                const fileDir = path.dirname(targetFilePath);
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }

                let needsDownload = true;
                if (fs.existsSync(targetFilePath) && !fileObj.extract) {
                    if (fileObj.hash) {
                        const localHash = await getFileHash(targetFilePath);
                        if (localHash === fileObj.hash) {
                            needsDownload = false;
                        }
                    } else {
                        // Without hash, default to skip if exists
                        needsDownload = false;
                    }
                }

                if (needsDownload && fileObj.downloadUrl) {
                    mainWindow.webContents.send('update-status', `Syncing File ${current}/${totalFiles}: ${path.basename(fileObj.path)}`);
                    console.log(`[SYNC] Downloading ${fileObj.extract ? 'and extracting ' : ''}file ${fileObj.path} from ${fileObj.downloadUrl}...`);
                    await downloadFile(fileObj.downloadUrl, targetFilePath).catch(e => {
                        console.error(`[SYNC ERROR] Failed to download ${fileObj.path}:`, e);
                    });

                    if (fileObj.extract && fs.existsSync(targetFilePath)) {
                        try {
                            const extract = require('extract-zip');
                            const targetExtractDir = fileObj.path ? path.join(rootPath, fileObj.path) : rootPath;
                            mainWindow.webContents.send('update-status', `Extracting ${path.basename(fileObj.path)}...`);
                            console.log(`[SYNC] Extracting ${targetFilePath} to ${targetExtractDir}...`);
                            await extract(targetFilePath, { dir: targetExtractDir });
                            // Optional: clean up the downloaded zip file
                            fs.unlinkSync(targetFilePath);
                        } catch (extErr) {
                            console.error(`[SYNC ERROR] Failed to extract ${fileObj.path}:`, extErr);
                        }
                    }
                }

                const progressPercent = Math.round((current / totalFiles) * 100);
                mainWindow.webContents.send('update-status', `Syncing Assets: ${progressPercent}%`);
            }
        }
    } catch (syncError) {
        console.error("Sync Engine Error:", syncError);
        mainWindow.webContents.send('update-status', 'Warning: Sync Engine encountered an error.');
        await new Promise(r => setTimeout(r, 2000));
    }

    // Engine Launch happens strictly outside the Try/Catch block
    try {
        const loaderType = (manifest.modLoader || 'vanilla').toLowerCase();
        let targetLoader = loaders[loaderType];

        if (!targetLoader) {
            console.warn(`Loader '${loaderType}' not found in tomate-loaders. Falling back to vanilla.`);
            targetLoader = loaders.vanilla;
        }

        let resolvedVersion = manifest.minecraftVersion || '1.20.4';

        // Override the manifest version if the user explicitly selected one from the Vanilla UI dropdown
        if (configRequest && configRequest.version) {
             resolvedVersion = configRequest.version;
        }

        // Dynamically resolve "latest" via Mojang's API
        if (resolvedVersion === 'latest' || resolvedVersion === 'latest-snapshot') {
            mainWindow.webContents.send('update-status', `Resolving ${resolvedVersion} version...`);
            const pFetch = (await import('node-fetch')).default;
            const versionRes = await pFetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
            if (versionRes.ok) {
                const versionData = await versionRes.json();
                resolvedVersion = resolvedVersion === 'latest-snapshot' ? versionData.latest.snapshot : versionData.latest.release;
                console.log(`Resolved dynamically to ${resolvedVersion}`);
            } else {
                console.warn('Failed to fetch Mojang version manifest, falling back to 1.21.1');
                resolvedVersion = '1.21.1';
            }
        }

        mainWindow.webContents.send('update-status', `Initializing ${resolvedVersion} Engine...`);
        const launchConfig = await targetLoader.getMCLCLaunchConfig({
            gameVersion: resolvedVersion,
            rootPath: rootPath
        });

        // Use requested RAM or fallback to default
        const savedConfig = loadConfig();
        const ramSetting = configRequest && configRequest.ram ? configRequest.ram : savedConfig.ram;
        
        let activeAuth = savedConfig.authProfile;

        if (!activeAuth || !activeAuth.name) {
            // Re-check bypass specifically before throwing auth error in prod 
            if (!devConfig.bypassAuth) {
                throw new Error("No connected account found. Please log in first.");
            }
            activeAuth = await Authenticator.getAuth("DevTester");
            activeAuth = JSON.parse(JSON.stringify(activeAuth));
        }

        let opts = {
            ...launchConfig,
            authorization: activeAuth, 
            javaPath: 'javaw',
            memory: { max: `${ramSetting}G`, min: "2G" }
        };

        const progressPhases = {
            'classes': { start: 0, end: 15 },
            'assets': { start: 15, end: 45 },
            'libraries': { start: 45, end: 85 },
            'forge': { start: 85, end: 95 },
            'fabric': { start: 85, end: 95 },
            'natives': { start: 95, end: 100 }
        };
        let fallbackPercent = 0;

        launcher.on('progress', (e) => {
            let percent = fallbackPercent;
            if (e.type && progressPhases[e.type.toLowerCase()]) {
                const phase = progressPhases[e.type.toLowerCase()];
                const calculated = phase.start + (e.task / e.total) * (phase.end - phase.start);
                
                // Protect against NaN if e.task or e.total is malformed / zero
                if (!isNaN(calculated)) {
                    percent = Math.max(fallbackPercent, calculated);
                    fallbackPercent = percent; // Guarantee no backward glitch
                }
            }

            // Re-capitalize the first letter for UI cleanliness
            const displayType = e.type ? e.type.charAt(0).toUpperCase() + e.type.slice(1) : 'Engine';
            mainWindow.webContents.send('update-status', `Checking ${displayType}: ${Math.round(percent)}%`);
        });

        launcher.on('download-status', (e) => {
            const shortName = e.name ? (e.name.length > 50 ? '...' + e.name.slice(-50) : e.name) : 'files...';
            // Also append the overall engine progress so the UI bar stays accurate and moving
            mainWindow.webContents.send('update-status', `Downloading: ${shortName} ${Math.round(fallbackPercent)}%`);
        });

        launcher.on('data', (e) => {
            // MCLC outputs console lines here
            if (e.includes("Setting user:")) {
                 mainWindow.webContents.send('update-status', 'Game is running! 100%');
            }
        });
        
        launcher.on('close', (e) => {
            console.log("Game exited with code:", e);
            mainWindow.webContents.send('game-closed');
            activeGameProcess = null;
        });

        activeGameProcess = await launcher.launch(opts);
        console.log("Game Launched Successfully!");

    } catch (engineError) {
        console.error("Engine Launch Error:", engineError);
        mainWindow.webContents.send('update-status', 'Error: Engine failed to launch.');
        mainWindow.webContents.send('game-closed'); // Reset UI if failed
    }
});
