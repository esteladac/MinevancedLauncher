// --- PERFORMANCE TRACKER ---
const { performance } = require('perf_hooks');
const timeStart = performance.now();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch(e) { console.error("Error holding config:", e); }
    return { ram: 4, debugSplash: false }; // Default fallback
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

bootLog("STEP 4: Electron app object acquired. Calling app.whenReady()...");
app.whenReady().then(() => {
    bootLog("STEP 6: app.whenReady() resolved! Chromium engine is initialized and ready.");
    createWindow();
});
bootLog("STEP 5: Wait assigned to app.whenReady(). Main thread now yielding.");

// --- Window Controls ---
ipcMain.on('window-minimize', () => mainWindow.minimize());
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
    const targetInstance = instanceName || 'minevanced';
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

// --- Read Modpack Manifests ---
ipcMain.on('request-modpacks', (event) => {
    const manifestsPath = path.join(app.getAppPath(), 'manifests');
    let modpacks = [];
    if (fs.existsSync(manifestsPath)) {
        try {
            const files = fs.readdirSync(manifestsPath);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const content = fs.readFileSync(path.join(manifestsPath, file), 'utf8');
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

        // Multi-account array storage logic
        let existing = savedConfig.accounts.findIndex(a => a.profile.uuid === mclcAuth.uuid);
        if (existing >= 0) savedConfig.accounts[existing] = { type: 'microsoft', profile: mclcAuth };
        else savedConfig.accounts.push({ type: 'microsoft', profile: mclcAuth });
        
        savedConfig.activeAccountId = mclcAuth.uuid;
        saveConfig(savedConfig);
        
        event.sender.send('auth-success', { accounts: savedConfig.accounts, activeId: savedConfig.activeAccountId });
    } catch (err) {
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

ipcMain.on('login-offline', async (event, username) => {
    try {
        let auth = await Authenticator.getAuth(username);
        // Strip out any non-serializable classes, functions, or promises down to POJO
        auth = JSON.parse(JSON.stringify(auth));
        
        let existing = savedConfig.accounts.findIndex(a => a.profile.uuid === auth.uuid);
        if (existing >= 0) savedConfig.accounts[existing] = { type: 'offline', profile: auth };
        else savedConfig.accounts.push({ type: 'offline', profile: auth });
        
        savedConfig.activeAccountId = auth.uuid;
        saveConfig(savedConfig);
        
        event.sender.send('auth-success', { accounts: savedConfig.accounts, activeId: savedConfig.activeAccountId });
    } catch (err) {
        event.sender.send('auth-failed', "Failed to create offline profile.");
    }
});

// --- Launch Engine (Lazy Loaded) ---
let activeGameProcess = null;

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
    const instanceName = configRequest.instance || 'minevanced';
    
    const crypto = require('crypto');
    const https = require('https'); 
    const http = require('http');
    const { Client } = require('minecraft-launcher-core');
    const { fabric } = require('tomate-loaders');
    
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
            client.get(url, (response) => {
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
        mainWindow.webContents.send('update-status', 'Loading Modpack Manifest...');
        
        const manifestFilePath = path.join(app.getAppPath(), 'manifests', `${instanceName}.json`);
        if (fs.existsSync(manifestFilePath)) {
            const rawData = fs.readFileSync(manifestFilePath, 'utf8');
            manifest = JSON.parse(rawData);
            mainWindow.webContents.send('update-status', `Loaded Manifest: ${manifest.minecraftVersion}`);
        } else {
            throw new Error(`Manifest not found at ${manifestFilePath}`);
        }
        
    } catch (err) {
        console.warn("Failed to load local manifest. Entering fallback.", err.message);
        mainWindow.webContents.send('update-status', 'Manifest Load Failed - Fallback Version');
        
        // Artificial delay so the UI shows the "warning" message before jumping into the engine
        await new Promise(r => setTimeout(r, 2000));
    }
    
        // Engine Launch happens strictly outside the Try/Catch block
    try {
        mainWindow.webContents.send('update-status', `Initializing ${manifest.minecraftVersion} Engine...`);
        const launchConfig = await fabric.getMCLCLaunchConfig({
            gameVersion: manifest.minecraftVersion || '1.20.4',
            rootPath: rootPath
        });

        // Use requested RAM or fallback to default
        const savedConfig = loadConfig();
        const ramSetting = configRequest && configRequest.ram ? configRequest.ram : savedConfig.ram;
        
        let activeAuth = savedConfig.authProfile;
        // Fallback to testing identity if no user ever logged in
        if (!activeAuth || !activeAuth.name) {
            activeAuth = await Authenticator.getAuth("MinevancedTester");
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
                percent = Math.max(fallbackPercent, calculated);
                fallbackPercent = percent; // Guarantee no backward glitch
            }
            
            // Re-capitalize the first letter for UI cleanliness
            const displayType = e.type ? e.type.charAt(0).toUpperCase() + e.type.slice(1) : 'Engine';
            mainWindow.webContents.send('update-status', `Checking ${displayType}: ${Math.round(percent)}%`);
        });

        launcher.on('download-status', (e) => {
            const shortName = e.name ? (e.name.length > 50 ? '...' + e.name.slice(-50) : e.name) : 'files...';
            // Send what file is currently downloading, without sending a percentage that would confuse the UI bar
            mainWindow.webContents.send('update-status', `Downloading: ${shortName}`);
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