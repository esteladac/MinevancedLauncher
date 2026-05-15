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

// --- Crash Handling System ---
let crashLogPath = null;
let crashWindow = null;
let gameOutputLog = []; // Store game output for crash analysis
const MAX_OUTPUT_LINES = 1000;

function getCrashLogsDir() {
    const dir = path.join(app.getPath('appData'), 'minevanced_launcher', 'crash_logs');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function parseDependencyErrors(output) {
    const depErrors = [];
    const depPattern = /Mod ID: '([^']+)',\s*Requested by: '([^']+)',\s*Expected range: '([^']+)',\s*Actual version: '([^']+)'/g;
    let match;
    while ((match = depPattern.exec(output)) !== null) {
        depErrors.push({
            modId: match[1],
            requestedBy: match[2],
            expectedRange: match[3],
            actualVersion: match[4]
        });
    }
    return depErrors;
}

function writeCrashLog(errorType, errorMessage, stack, context = {}) {
    try {
        const timestamp = new Date().toISOString();
        const filename = `crash-${Date.now()}.json`;
        const crashLogsDir = getCrashLogsDir();
        crashLogPath = path.join(crashLogsDir, filename);
        
        // Parse dependency errors from output if present
        const fullOutput = gameOutputLog.join('\n');
        const dependencyErrors = parseDependencyErrors(fullOutput);
        
        // Detect if this is a NeoForge dependency error
        let isNeoForgeDependencyError = false;
        if (fullOutput.includes('Missing or unsupported mandatory dependencies') && 
            fullOutput.includes('neoforge')) {
            isNeoForgeDependencyError = true;
        }
        
        const crashData = {
            timestamp,
            type: errorType,
            message: errorMessage,
            stack: stack || 'No stack trace available',
            context,
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
            appVersion: app.getVersion ? app.getVersion() : 'unknown',
            isDependencyError: isNeoForgeDependencyError || dependencyErrors.length > 0,
            dependencyErrors,
            gameOutput: gameOutputLog.slice(-100) // Last 100 lines for context
        };
        
        fs.writeFileSync(crashLogPath, JSON.stringify(crashData, null, 2));
        console.error(`[CRASH] Logged to ${crashLogPath}`);
        return crashLogPath;
    } catch (e) {
        console.error('[CRASH] Failed to write crash log:', e);
        return null;
    }
}

function showCrashWindow(errorType, errorMessage, stack) {
    try {
        if (crashWindow && !crashWindow.isDestroyed()) {
            crashWindow.focus();
            return;
        }
        
        crashWindow = new BrowserWindow({
            width: 700,
            height: 600,
            frame: false,
            icon: path.join(__dirname, 'logo.png'),
            resizable: true,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        
        const crashHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Minevanced - Crash Report</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                :root {
                    --bg-dark: #121016;
                    --module-bg: rgba(25, 20, 30, 0.72);
                    --accent-purple: #7B52F4;
                    --text-main: #FFFFFF;
                    --text-dim: #A09DA5;
                }
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: radial-gradient(circle at top, rgba(123, 82, 244, 0.18) 0%, #08060c 52%, #050409 100%);
                    color: var(--text-main);
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    padding: 0;
                    overflow: hidden;
                }
                .title-bar {
                    background: rgba(18, 16, 22, 0.9);
                    border-bottom: 1px solid rgba(255,255,255,0.08);
                    padding: 12px 18px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    user-select: none;
                    -webkit-user-select: none;
                    -webkit-app-region: drag;
                }
                .title-bar h2 {
                    font-size: 14px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    color: var(--text-main);
                }
                .title-controls {
                    display: flex;
                    gap: 8px;
                    -webkit-app-region: no-drag;
                }
                .title-controls button {
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.08);
                    color: var(--text-main);
                    cursor: pointer;
                    padding: 6px 12px;
                    font-size: 16px;
                    border-radius: 999px;
                    transition: 0.2s;
                }
                .title-controls button:hover {
                    background: rgba(255,255,255,0.12);
                }
                .crash-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    padding: 18px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    min-height: 0;
                }
                .crash-header {
                    text-align: center;
                    margin-bottom: 16px;
                }
                .crash-header .icon {
                    font-size: 46px;
                    margin-bottom: 8px;
                }
                .crash-header h1 {
                    font-size: 20px;
                    color: #ff6b6b;
                    margin-bottom: 8px;
                }
                .crash-header p {
                    color: var(--text-dim);
                    font-size: 13px;
                }
                .error-info {
                    background: var(--module-bg);
                    border: 1px solid rgba(255,107,107,0.22);
                    border-radius: 14px;
                    padding: 14px;
                    margin-bottom: 14px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.28);
                }
                .error-type {
                    font-weight: 600;
                    color: #ff6b6b;
                    font-size: 12px;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .error-message {
                    color: var(--text-main);
                    font-size: 13px;
                    word-break: break-word;
                    margin-bottom: 12px;
                }
                .stack-trace {
                    flex: 1 1 auto;
                    min-height: 220px;
                    background: rgba(8, 6, 12, 0.95);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 14px;
                    padding: 14px;
                    overflow-y: auto;
                    overflow-x: hidden;
                    font-family: Consolas, 'Courier New', monospace;
                    font-size: 11px;
                    color: #b7b3bf;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    margin-bottom: 15px;
                    min-height: 0;
                }
                .crash-content::-webkit-scrollbar,
                .stack-trace::-webkit-scrollbar {
                    width: 8px;
                }
                .crash-content::-webkit-scrollbar-track,
                .stack-trace::-webkit-scrollbar-track {
                    background: rgba(255,255,255,0.04);
                    border-radius: 999px;
                }
                .crash-content::-webkit-scrollbar-thumb,
                .stack-trace::-webkit-scrollbar-thumb {
                    background: rgba(123, 82, 244, 0.55);
                    border-radius: 999px;
                    border: 2px solid rgba(8, 6, 12, 0.95);
                }
                .crash-content::-webkit-scrollbar-thumb:hover,
                .stack-trace::-webkit-scrollbar-thumb:hover {
                    background: rgba(157, 122, 255, 0.8);
                }
                .actions {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                button {
                    flex: 1;
                    padding: 12px;
                    border: none;
                    border-radius: 6px;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: 0.2s;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    min-width: 0;
                }
                .btn-restart {
                    background: linear-gradient(135deg, #7b52f4, #9d7aff);
                    color: white;
                }
                .btn-restart:hover {
                    opacity: 0.9;
                    transform: translateY(-1px);
                }
                .btn-close {
                    background: rgba(255,255,255,0.08);
                    color: var(--text-main);
                    border: 1px solid rgba(255,255,255,0.16);
                }
                .btn-close:hover {
                    background: rgba(255,255,255,0.14);
                }
            </style>
        </head>
        <body>
            <div class="title-bar">
                <h2>⚠️ Crash Report</h2>
                <div class="title-controls">
                    <button onclick="closeWindow()">✕</button>
                </div>
            </div>
            <div class="crash-content">
                <div class="crash-header">
                    <div class="icon">🔥</div>
                    <h1>Minevanced Crashed</h1>
                    <p>An unexpected error occurred</p>
                </div>
                <div class="error-info">
                    <div class="error-type" id="errorType"></div>
                    <div class="error-message" id="errorMessage"></div>
                </div>
                <div class="stack-trace" id="stackTrace"></div>
                <div class="actions">
                    <button class="btn-restart" onclick="restartApp()">Restart Application</button>
                    <button class="btn-close" onclick="closeWindow()">Close</button>
                </div>
            </div>
            <script>
                function closeWindow() {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('close-crash-window');
                }
                function restartApp() {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('restart-app');
                }
                const crashData = JSON.parse(decodeURIComponent(${JSON.stringify(encodeURIComponent(JSON.stringify({errorType, errorMessage, stack})))}));\n                document.getElementById('errorType').textContent = crashData.errorType || 'UNKNOWN ERROR';\n                document.getElementById('errorMessage').textContent = crashData.errorMessage || 'An unexpected error occurred';\n                document.getElementById('stackTrace').textContent = crashData.stack || 'No stack trace available';
            </script>
        </body>
        </html>
        `;
        
        crashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(crashHTML));
        crashWindow.once('ready-to-show', () => crashWindow.show());
    } catch (err) {
        console.error('[CRASH] Failed to show crash window:', err);
    }
}

// Global uncaught exception handler (main process)
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    writeCrashLog('UncaughtException', error.message, error.stack);
    showCrashWindow('UNCAUGHT EXCEPTION', error.message, error.stack);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : 'No stack trace';
    console.error('[UNHANDLED REJECTION]', reason);
    writeCrashLog('UnhandledRejection', errorMessage, stack);
    showCrashWindow('UNHANDLED PROMISE REJECTION', errorMessage, stack);
});

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

function getLauncherDataPath() {
    return path.join(app.getPath('appData'), 'minevanced_launcher');
}

// Safe IPC sender: only send when mainWindow and webContents are available
function safeSend(channel, ...args) {
    try {
        if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()
            && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send(channel, ...args);
        }
    } catch (err) {
        try { console.warn('[safeSend] failed for', channel, err && err.message); } catch (_) {}
    }
}

// --- PORTABLE JAVA MANAGER ---
function getRequiredJavaVersion(minecraftVersion) {
    // Parse MC version to semantic version for comparison
    const parts = minecraftVersion.split('.');
    const major = parseInt(parts[0]) || 0;
    const minor = parseInt(parts[1]) || 0;

    // Newer versions may use non-1.x numbering (e.g. 26.x) and require newer Java.
    if (major >= 26) return '25';
    if (major >= 24) return '21';
    
    // Minecraft version → Java version mapping
    if (major > 1 || (major === 1 && minor >= 21)) return '21'; // 1.21+
    if (major === 1 && minor >= 20 && parseInt(parts[2] || 0) >= 5) return '21'; // 1.20.5+
    if (major === 1 && minor >= 18) return '17'; // 1.18-1.20.4
    if (major === 1 && minor === 17) return '16'; // 1.17
    return '8'; // 1.16 and earlier
}

async function getJavaPortable(minecraftVersion, dbgFunc) {
    const javaVersion = getRequiredJavaVersion(minecraftVersion);
    const javaDir = path.join(getLauncherDataPath(), 'java', `jdk-${javaVersion}`);
    const javawPath = path.join(javaDir, 'bin', 'javaw.exe');
    const javaExePath = path.join(javaDir, 'bin', 'java.exe');
    const existingJavaPath = fs.existsSync(javawPath) ? javawPath : (fs.existsSync(javaExePath) ? javaExePath : null);
    
    dbgFunc && dbgFunc('java portable check', {
        minecraftVersion,
        javaVersion,
        javawPath,
        javaExePath,
        existingJavaPath,
        javawExists: fs.existsSync(javawPath),
        javaExeExists: fs.existsSync(javaExePath)
    });
    
    if (existingJavaPath) {
        return existingJavaPath; // Already present
    }
    
    dbgFunc && dbgFunc('java portable missing, initiating download', { javaVersion });
    
    // Determine download URL for portable JDK (using Adoptium/Eclipse Temurin)
    // Format: https://github.com/adoptium/temurin{version}-binaries/releases/download/jdk-{version}.{patch}/OpenJDK{version}U-jdk_x64_windows_hotspot_{major}_{patch}.zip
    const downloadUrl = await getJavaDownloadUrl(javaVersion, dbgFunc);
    if (!downloadUrl) {
        throw new Error(`Failed to determine download URL for Java ${javaVersion}`);
    }
    
    dbgFunc && dbgFunc('java download URL resolved', { javaVersion, downloadUrl });
    
    // Create java directory if needed
    const javaBaseDir = path.join(getLauncherDataPath(), 'java');
    if (!fs.existsSync(javaBaseDir)) {
        fs.mkdirSync(javaBaseDir, { recursive: true });
        dbgFunc && dbgFunc('java base directory created', javaBaseDir);
    }
    
    // Download Java
    const zipPath = path.join(javaBaseDir, `jdk-${javaVersion}.zip`);
    dbgFunc && dbgFunc('starting java download', { zipPath });
    
    await downloadJavaFile(downloadUrl, zipPath, dbgFunc);
    dbgFunc && dbgFunc('java download complete', zipPath);
    
    // Extract Java
    const extract = require('extract-zip');
    dbgFunc && dbgFunc('extracting java archive', { zipPath, targetDir: javaDir });
    
    const tempExtractDir = path.join(javaBaseDir, `jdk-${javaVersion}-temp`);
    
    try {
        // Clean up any previous temp extraction
        if (fs.existsSync(tempExtractDir)) {
            fs.rmSync(tempExtractDir, { recursive: true, force: true });
        }
        
        await extract(zipPath, { dir: tempExtractDir });
        dbgFunc && dbgFunc('java archive extracted to temp', tempExtractDir);
        
        // List extracted contents for debugging
        const extractedItems = fs.readdirSync(tempExtractDir);
        dbgFunc && dbgFunc('temp extraction contents', { items: extractedItems });
        
        // Recursively find a valid Java home containing bin/javaw.exe or bin/java.exe.
        // Some archives have additional nesting like .../debug-image/jdk-21.0.10+7/.
        let sourcePath = tempExtractDir;
        let javaBinaryPath = null;
        const scannedDirs = [];
        
        const findJavaHome = (startDir, maxDepth = 8) => {
            const stack = [{ dir: startDir, depth: 0 }];
            const visited = new Set();
            
            while (stack.length > 0) {
                const current = stack.pop();
                if (!current || visited.has(current.dir)) {
                    continue;
                }
                visited.add(current.dir);
                if (scannedDirs.length < 30) {
                    scannedDirs.push(current.dir);
                }
                
                const candidateJavaw = path.join(current.dir, 'bin', 'javaw.exe');
                const candidateJava = path.join(current.dir, 'bin', 'java.exe');
                if (fs.existsSync(candidateJavaw)) {
                    return { home: current.dir, binaryPath: candidateJavaw };
                }
                if (fs.existsSync(candidateJava)) {
                    return { home: current.dir, binaryPath: candidateJava };
                }
                
                if (current.depth >= maxDepth) {
                    continue;
                }
                
                let children = [];
                try {
                    children = fs.readdirSync(current.dir)
                        .map(name => path.join(current.dir, name))
                        .filter(fullPath => {
                            try {
                                return fs.statSync(fullPath).isDirectory();
                            } catch (_) {
                                return false;
                            }
                        });
                } catch (_) {
                    children = [];
                }
                
                for (const child of children) {
                    stack.push({ dir: child, depth: current.depth + 1 });
                }
            }
            
            return null;
        };
        
        const javaHomeResult = findJavaHome(tempExtractDir, 8);
        if (!javaHomeResult) {
            const errorMsg = `Could not find valid JDK structure. Extracted: ${extractedItems.join(', ')}. Scanned directories: ${scannedDirs.join('; ')}`;
            dbgFunc && dbgFunc('jdk extraction structure error', { errorMsg, scannedDirs });
            throw new Error(errorMsg);
        }
        
        sourcePath = javaHomeResult.home;
        javaBinaryPath = javaHomeResult.binaryPath;
        dbgFunc && dbgFunc('found java home recursively', { sourcePath, javaBinaryPath });
        
        dbgFunc && dbgFunc('moving java to final location', { from: sourcePath, to: javaDir });
        
        // Move to final location
        if (fs.existsSync(javaDir)) {
            fs.rmSync(javaDir, { recursive: true, force: true });
        }
        fs.renameSync(sourcePath, javaDir);
        
        // Verify the move worked
        const installedJavaPath = fs.existsSync(javawPath) ? javawPath : (fs.existsSync(javaExePath) ? javaExePath : null);
        if (!installedJavaPath) {
            let dirContents = [];
            try {
                dirContents = fs.readdirSync(javaDir);
            } catch (_) {
                dirContents = [];
            }
            throw new Error(`Java move/extraction failed. Expected ${javawPath} or ${javaExePath} but found: ${dirContents.join(', ')}`);
        }
        
        dbgFunc && dbgFunc('java installation complete', { javaDir, javaPath: installedJavaPath });
        return installedJavaPath;
    } catch (err) {
        dbgFunc && dbgFunc('java extraction failed', { error: err.message, stack: err.stack });
        
        // Cleanup on error
        try {
            if (fs.existsSync(tempExtractDir)) {
                fs.rmSync(tempExtractDir, { recursive: true, force: true });
                dbgFunc && dbgFunc('cleaned up temp dir after error', tempExtractDir);
            }
        } catch (cleanupErr) {
            dbgFunc && dbgFunc('temp cleanup failed', cleanupErr.message);
        }
        
        throw err;
    } finally {
        // Final cleanup of zip file
        try {
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
                dbgFunc && dbgFunc('cleaned up zip file', zipPath);
            }
        } catch (zipErr) {
            dbgFunc && dbgFunc('zip cleanup failed', zipErr.message);
        }
    }
}

async function getJavaDownloadUrl(javaVersion, dbgFunc) {
    try {
        // Temurin releases: https://api.github.com/repos/adoptium/temurin{version}-binaries/releases
        const repoName = `temurin${javaVersion}-binaries`;
        const apiUrl = `https://api.github.com/repos/adoptium/${repoName}/releases/latest`;
        
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            dbgFunc && dbgFunc('failed to fetch java releases', { javaVersion, status: response.status });
            return null;
        }
        
        const release = await response.json();
        
        const assets = release.assets || [];
        const preferredAsset = assets.find(a =>
            a.name.includes('OpenJDK') &&
            a.name.includes('jdk_x64_windows_hotspot') &&
            a.name.endsWith('.zip')
        );
        
        const fallbackAsset = assets.find(a => {
            const name = a.name.toLowerCase();
            return name.includes('openjdk') &&
                name.includes('windows') &&
                name.includes('x64') &&
                name.includes('jdk') &&
                name.endsWith('.zip') &&
                !name.includes('debugimage') &&
                !name.includes('testimage') &&
                !name.includes('static-libs') &&
                !name.includes('sources');
        });
        
        const asset = preferredAsset || fallbackAsset;
        
        if (!asset) {
            dbgFunc && dbgFunc('no suitable java asset found in release', { javaVersion, availableAssets: release.assets?.map(a => a.name) });
            return null;
        }
        
        dbgFunc && dbgFunc('selected java asset', { javaVersion, assetName: asset.name, url: asset.browser_download_url });
        
        return asset.browser_download_url;
    } catch (err) {
        dbgFunc && dbgFunc('error resolving java download URL', { javaVersion, error: err.message });
        return null;
    }
}

async function downloadJavaFile(url, dest, dbgFunc, retryCount = 0, maxRetries = 3) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const canRenderBar = !!(process.stdout && process.stdout.isTTY);
        let barStarted = false;
        let lastRenderedPercent = -1;
        let lastRenderTime = 0;

        const finishBarLine = () => {
            if (canRenderBar && barStarted) {
                process.stdout.write('\n');
                barStarted = false;
            }
        };

        const renderProgressBar = (downloadedSize, totalSize, force = false) => {
            if (!canRenderBar || totalSize <= 0) {
                return;
            }

            const percent = Math.min(100, Math.floor((downloadedSize / totalSize) * 100));
            const now = Date.now();
            if (!force && percent === lastRenderedPercent && (now - lastRenderTime) < 100) {
                return;
            }

            const width = 30;
            const filled = Math.round((percent / 100) * width);
            const bar = `${'='.repeat(filled)}${'-'.repeat(width - filled)}`;
            const downloadedMb = (downloadedSize / (1024 * 1024)).toFixed(1);
            const totalMb = (totalSize / (1024 * 1024)).toFixed(1);

            barStarted = true;
            process.stdout.write(`\rJava download [${bar}] ${String(percent).padStart(3)}% ${downloadedMb}/${totalMb} MB`);

            lastRenderedPercent = percent;
            lastRenderTime = now;

            if (force && percent >= 100) {
                finishBarLine();
            }
        };
        
        // Clean up any existing file before starting
        if (fs.existsSync(dest)) {
            try {
                fs.unlinkSync(dest);
            } catch (e) {
                // ignore
            }
        }
        
        const file = fs.createWriteStream(dest);
        
        https.get(url, { headers: { 'User-Agent': 'Minevanced Launcher' } }, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                file.close();
                return downloadJavaFile(response.headers.location, dest, dbgFunc, retryCount, maxRetries).then(resolve).catch(reject);
            }
            
            if (response.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(dest); } catch (e) {}
                finishBarLine();
                
                const isTransient = response.statusCode >= 500 && response.statusCode < 600;
                const shouldRetry = isTransient && retryCount < maxRetries;
                
                dbgFunc && dbgFunc('java download http error', { 
                    url, 
                    statusCode: response.statusCode, 
                    isTransient, 
                    retryCount,
                    maxRetries,
                    shouldRetry
                });
                
                if (shouldRetry) {
                    const delayMs = 2000 * (retryCount + 1); // Exponential backoff: 2s, 4s, 6s
                    dbgFunc && dbgFunc('java download retrying', { 
                        statusCode: response.statusCode,
                        attempt: retryCount + 1,
                        maxRetries,
                        delayMs
                    });
                    setTimeout(() => {
                        downloadJavaFile(url, dest, dbgFunc, retryCount + 1, maxRetries).then(resolve).catch(reject);
                    }, delayMs);
                } else {
                    reject(`HTTP ${response.statusCode}: ${url}`);
                }
                return;
            }
            
            const totalSize = parseInt(response.headers['content-length'] || 0);
            let downloadedSize = 0;
            
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                renderProgressBar(downloadedSize, totalSize);
            });
            
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                renderProgressBar(downloadedSize, totalSize, true);
                finishBarLine();
                dbgFunc && dbgFunc('java download stream finished', dest);
                resolve();
            });
        }).on('error', (err) => {
            file.close();
            try { fs.unlinkSync(dest); } catch (e) {}
            finishBarLine();
            
            if (retryCount < maxRetries) {
                const delayMs = 2000 * (retryCount + 1);
                dbgFunc && dbgFunc('java download error, retrying', { 
                    url,
                    error: err.message,
                    attempt: retryCount + 1,
                    maxRetries,
                    delayMs
                });
                setTimeout(() => {
                    downloadJavaFile(url, dest, dbgFunc, retryCount + 1, maxRetries).then(resolve).catch(reject);
                }, delayMs);
            } else {
                dbgFunc && dbgFunc('java download network error (max retries exceeded)', { url, error: err.message });
                reject(err);
            }
        });
    });
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
                    safeSend('trigger-minimize-animation');
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
    const modsPath = path.join(getLauncherDataPath(), targetInstance, 'mods');
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

        // Read locally-stored invite codes from config and fetch their manifests from server at runtime
        try {
            const conf = loadConfig();
            const invites = conf.invites || {};
            const fetch = (await import('node-fetch')).default;
            for (const [inviteId, inviteCode] of Object.entries(invites)) {
                try {
                    const r = await fetch('http://localhost:8080/invite/resolve', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code: inviteCode })
                    });
                    const d = await r.json().catch(() => ({}));
                    if (d && d.success && d.manifest) {
                        const localData = d.manifest;
                        localData.inviteCode = inviteCode;
                        localData.requiresInviteCode = true;
                        localData.isOfficial = false;
                        if (!onlinePacks.find(p => p.id === localData.id)) {
                            onlinePacks.push(localData);
                        }
                    }
                } catch (e) {
                    console.error('Failed fetching invite manifest for', inviteId, e && e.message);
                }
            }
        } catch (e) {
            // Non-fatal: continue without invite manifests if config/read fails
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

            // Persist invite code in user config instead of writing the full manifest to disk.
            // The launcher will fetch the manifest from the server at runtime using this code.
            try {
                const cfg = loadConfig();
                cfg.invites = cfg.invites || {};
                cfg.invites[manifest.id] = String(code);
                saveConfig(cfg);
            } catch (e) {
                console.error('Failed to persist invite code to config:', e);
            }

            event.sender.send('invite-success', `Invite accepted. Modpack '${manifest.name}' will be fetched from server when needed.`);
        } else {
            event.sender.send('invite-error', data.error || 'Invalid invite code.');
        }
    } catch (err) {
        console.error('Invite resolution failed:', err);
        event.sender.send('invite-error', 'Server offline or unreachable.');
    }
});

function getProtectedModpackIds() {
    const protectedIds = new Set(['vanilla', 'minevanced', 'minevanced-modded', 'minevanced-optimized']);

    try {
        const builtinPath = path.join(__dirname, '.builtin-packs.json');
        if (fs.existsSync(builtinPath)) {
            const builtins = JSON.parse(fs.readFileSync(builtinPath, 'utf-8'));
            if (Array.isArray(builtins)) {
                for (const pack of builtins) {
                    if (pack && pack.id) {
                        protectedIds.add(String(pack.id));
                    }
                }
            }
        }
    } catch (e) {
        console.error('Failed loading protected built-in pack IDs:', e);
    }

    return protectedIds;
}

ipcMain.on('delete-instance', (event, targetId) => {
    try {
        const normalizedId = String(targetId || '').trim();
        if (!normalizedId) {
            event.sender.send('invite-error', 'Invalid modpack ID.');
            return;
        }

        const protectedIds = getProtectedModpackIds();
        if (protectedIds.has(normalizedId)) {
            event.sender.send('invite-error', 'This built-in modpack cannot be deleted. Use Reinstall instead.');
            return;
        }

        const baseDir = getLauncherDataPath();
        const pathsToDelete = [
            path.join(baseDir, normalizedId),
            path.join(baseDir, 'instances', normalizedId),
            path.join(baseDir, 'manifests', `${normalizedId}.json`),
            path.join(baseDir, 'manifests', `INVITE_${normalizedId}.json`),
            path.join(app.getAppPath(), 'manifests', `${normalizedId}.json`),
            path.join(app.getAppPath(), 'manifests', `INVITE_${normalizedId}.json`),
            path.join(app.getAppPath(), 'modpacks', `${normalizedId}.json`),
            path.join(app.getAppPath(), 'modpacks', `INVITE_${normalizedId}.json`)
        ];

        for (const targetPath of pathsToDelete) {
            try {
                if (fs.existsSync(targetPath)) {
                    fs.rmSync(targetPath, { recursive: true, force: true });
                }
            } catch (removeErr) {
                console.error('Failed removing path:', targetPath, removeErr);
            }
        }

        // Also remove stored invite code from config if present
        try {
            const cfg = loadConfig();
            if (cfg.invites && cfg.invites[normalizedId]) {
                delete cfg.invites[normalizedId];
                saveConfig(cfg);
            }
        } catch (e) {
            console.error('Failed to remove invite code from config during delete:', e);
        }

        event.sender.send('invite-success', 'Modpack, instance files, and manifests deleted successfully.');

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
// --- Crash Handling IPC ---
ipcMain.on('close-crash-window', () => {
    if (crashWindow && !crashWindow.isDestroyed()) {
        crashWindow.close();
        crashWindow = null;
    }
});

ipcMain.on('restart-app', () => {
    if (crashWindow && !crashWindow.isDestroyed()) {
        crashWindow.close();
    }
    app.relaunch();
    app.exit(0);
});

ipcMain.handle('get-crash-logs', async () => {
    try {
        const crashLogsDir = getCrashLogsDir();
        if (!fs.existsSync(crashLogsDir)) return [];
        
        const files = fs.readdirSync(crashLogsDir)
            .filter(f => f.startsWith('crash-') && f.endsWith('.json'))
            .sort()
            .reverse()
            .slice(0, 20); // Latest 20 crashes
        
        return files.map(filename => {
            const filepath = path.join(crashLogsDir, filename);
            try {
                const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
                return {
                    filename,
                    timestamp: data.timestamp,
                    type: data.type,
                    message: data.message,
                    path: filepath
                };
            } catch (e) {
                return { filename, error: 'Failed to parse' };
            }
        });
    } catch (e) {
        console.error('Failed to get crash logs:', e);
        return [];
    }
});

ipcMain.handle('get-crash-log-content', async (event, filepath) => {
    try {
        if (!filepath || !filepath.includes('crash-')) return null;
        return fs.readFileSync(filepath, 'utf8');
    } catch (e) {
        console.error('Failed to read crash log:', e);
        return null;
    }
});

ipcMain.handle('send-crash-log-to-server', async (event, crashLogPath) => {
    try {
        if (!crashLogPath || !fs.existsSync(crashLogPath)) {
            return { success: false, error: 'Crash log file not found' };
        }
        
        const crashData = JSON.parse(fs.readFileSync(crashLogPath, 'utf8'));
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch('http://localhost:8080/api/crash-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timestamp: crashData.timestamp,
                type: crashData.type,
                message: crashData.message,
                stack: crashData.stack,
                isDependencyError: crashData.isDependencyError,
                dependencyErrors: crashData.dependencyErrors,
                platform: crashData.platform,
                arch: crashData.arch,
                nodeVersion: crashData.nodeVersion,
                electronVersion: crashData.electronVersion,
                appVersion: crashData.appVersion,
                gameOutput: crashData.gameOutput
            })
        });
        
        if (response.ok) {
            return { success: true, message: 'Crash log sent to server' };
        } else {
            return { success: false, error: `Server error: ${response.status}` };
        }
    } catch (error) {
        console.error('[CRASH LOG SEND ERROR]', error);
        return { success: false, error: error.message };
    }
});

ipcMain.on('delete-all-crash-logs', () => {
    try {
        const crashLogsDir = getCrashLogsDir();
        if (fs.existsSync(crashLogsDir)) {
            const files = fs.readdirSync(crashLogsDir);
            files.forEach(file => {
                if (file.startsWith('crash-') && file.endsWith('.json')) {
                    try {
                        fs.unlinkSync(path.join(crashLogsDir, file));
                    } catch (e) {
                        console.error('Failed to delete crash log file:', file, e);
                    }
                }
            });
            console.log('[CRASH] Deleted all crash logs');
        }
    } catch (e) {
        console.error('[CRASH] Failed to delete crash logs:', e);
    }
});

// Handle render process crashes
app.on('render-process-gone', (event, details) => {
    console.error('[RENDER PROCESS GONE]', details);
    const reason = details.reason === 'killed' ? 'killed by OS' : details.reason;
    writeCrashLog('RenderProcessGone', `Renderer crashed: ${reason}`, 'Render process terminated unexpectedly', details);
    if (details.reason !== 'clean-exit') {
        showCrashWindow('RENDERER CRASHED', `The UI process crashed: ${reason}`, '');
    }
});

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
    const launchTraceId = `LCH-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const dbg = (stage, details) => {
        const ts = new Date().toISOString();
        if (details !== undefined) {
            console.log(`[${launchTraceId}] [${ts}] ${stage}:`, details);
        } else {
            console.log(`[${launchTraceId}] [${ts}] ${stage}`);
        }
    };
    dbg('launch-game event received');
    // Removed verbose payload logging to reduce console spam
    // dbg('raw configRequest payload', {
    //     instance: configRequest && configRequest.instance,
    //     version: configRequest && configRequest.version,
    //     profile: configRequest && configRequest.profile,
    //     ram: configRequest && configRequest.ram
    // });
    
    // Validate payload
    if (!configRequest || !configRequest.instance || configRequest.ram === null || configRequest.ram === undefined) {
        const errMsg = 'Invalid launch payload received - ensure you have selected a modpack and created an account';
        dbg('ERROR', errMsg);
        safeSend('update-status', errMsg);
        safeSend('launch-error', { title: 'Launch Error', message: errMsg });
        return;
    }
    
    // Support multi-instance structure
      let instanceName = configRequest.instance || 'vanilla';
      // Removed verbose logging
      // dbg('initial instanceName', instanceName);

      // Apply nested built-in profiles properly to separate folders, removing the classic instance fallback
      if (instanceName === 'minevanced') {
          if (configRequest.profile === 'optimized') {
              instanceName = 'minevanced-optimized';
          } else {
              instanceName = 'minevanced-modded';
          }
      }
      // Removed verbose logging
      // dbg('resolved instanceName', instanceName);

    const crypto = require('crypto');
    const https = require('https');
    const http = require('http');
    const { Client, Authenticator } = require('minecraft-launcher-core');
    const loaders = require('tomate-loaders');

    // appData inherently points to C:\Users\User\AppData\Roaming on Windows
    const launcher = new Client();
    const rootPath = path.join(getLauncherDataPath(), instanceName);
    // Removed verbose platform/paths logging
    // dbg('platform details', {...});
    // dbg('paths', {...});
    // dbg('rootPath exists before sync', fs.existsSync(rootPath));

    function inferHashAlgorithm(hashValue) {
        const length = String(hashValue || '').trim().length;
        if (length === 40) return 'sha1';
        if (length === 64) return 'sha256';
        if (length === 128) return 'sha512';
        return 'sha256';
    }

    function getFileHash(filePath, algorithm = 'sha256') {
        return new Promise((resolve) => {
            if (!fs.existsSync(filePath)) return resolve(null); 
            const hash = crypto.createHash(algorithm);
            const stream = fs.createReadStream(filePath);
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', () => resolve(null));
        });
    }

    function downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            // Removed verbose download logging
            // dbg('download start', { url, dest });
            const file = fs.createWriteStream(dest);
            const client = url.startsWith('https') ? https : http;

            // Adding { rejectUnauthorized: false } bypasses strict SSL checks
            // which helps private setups with self-signed certs pass the download phase!
            client.get(url, { rejectUnauthorized: false }, (response) => {
                // Removed verbose response logging
                // dbg('download response', {...});
                if (response.statusCode === 301 || response.statusCode === 302) {
                    return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => file.close(() => {
                        // Removed verbose download complete logging
                        resolve();
                    }));
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
        // Removed verbose manifest phase logging
        safeSend('update-status', 'Fetching Manifest from Server...');
        const fetch = (await import('node-fetch')).default;

        let targetManifestUrl = `http://localhost:8080/manifests/files/${instanceName}.json`;
        const inviteCode = configRequest && typeof configRequest.inviteCode === 'string' ? configRequest.inviteCode.trim() : '';
        if (inviteCode) {
            targetManifestUrl += `?code=${encodeURIComponent(inviteCode)}`;
        }
        let manifestLoaded = false;
        // Removed verbose URL logging

        // 1. Check Dev Local Overrides
        if (instanceName.startsWith('[DEV]')) {
             const localPath = path.join(app.getAppPath(), 'manifests', `${instanceName}.json`);
             if (fs.existsSync(localPath)) {
                 manifest = JSON.parse(fs.readFileSync(localPath, 'utf8'));
                safeSend('update-status', `Loaded Native Dev Manifest: ${manifest.minecraftVersion}`);
                 manifestLoaded = true;
             } else {
                 throw new Error("Dev manifest not found locally.");
             }
        } 
        
        // 2. Check Built-in local fallbacks first to support offline/locked installations like the sub-packs
        const builtinPath = path.join(__dirname, '.builtin-packs.json');
        // Removed verbose builtin check logging
        if (!manifestLoaded && fs.existsSync(builtinPath)) {
            const builtins = JSON.parse(fs.readFileSync(builtinPath, 'utf-8'));
            const matchingBuiltin = builtins.find(b => b.id === instanceName);
            if (matchingBuiltin) {
                manifest = matchingBuiltin;
                safeSend('update-status', `Loaded Built-in Manifest: ${manifest.minecraftVersion}`);
                manifestLoaded = true;
            }
        }
        
        // 3. External Server Fetch as last resort
        if (!manifestLoaded) {
             const response = await fetch(targetManifestUrl);
             if (!response.ok) throw new Error(`Server returned ${response.status} for manifest`);
             manifest = await response.json();
                safeSend('update-status', `Loaded Remote Manifest: ${manifest.minecraftVersion}`);
        }
        // Removed verbose manifest summary logging

    } catch (err) {
        console.warn("Failed to load manifest. Entering fallback.", err.message);
        // Removed verbose manifest failure logging
        // If this launch attempted to use an invite code, surface an invite-specific error.
        const attemptedInviteCode = configRequest && typeof configRequest.inviteCode === 'string' ? String(configRequest.inviteCode).trim() : '';
        if (!attemptedInviteCode) {
            // No invite code supplied for a manifest that could require one
            safeSend('update-status', 'Manifest access denied. Invite code required.');
            safeSend('launch-error', {
                title: 'Invite Code Required',
                message: 'This modpack manifest requires a valid invite code. Add the invite code in the launcher and try again.'
            });
            return;
        } else {
            // An invite code was provided but manifest load still failed (likely invalid/expired)
            safeSend('update-status', 'Manifest access denied. Invite code invalid or expired.');
            safeSend('launch-error', {
                title: 'Invite Code Invalid',
                message: 'The invite code provided appears to be invalid or expired. Re-enter the invite code or contact the server administrator.'
            });
            return;
        }

        safeSend('update-status', 'Manifest Load Failed - Fallback Version');

        // Artificial delay so the UI shows the "warning" message before jumping into the engine
        await new Promise(r => setTimeout(r, 2000));
    }

    // --- MINEVANCED SYNC ENGINE (Mod Downloading) ---
    try {
        // Removed verbose sync phase logging
        // Sync Legacy Mods Array
        if (manifest.mods && Array.isArray(manifest.mods)) {
            const modsPath = path.join(rootPath, 'mods');
            // Removed verbose sync logging
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
                        const localHash = await getFileHash(targetFilePath, mod.hashAlgorithm || inferHashAlgorithm(mod.hash));
                        if (localHash === mod.hash) {
                            needsDownload = false;
                        }
                    } else {
                        // Without hash, assume correct if versioned file exists
                        needsDownload = false;
                    }
                }

                if (needsDownload && mod.downloadUrl) {
                    safeSend('update-status', `Syncing Mod ${current}/${totalMods}: ${mod.name}`);
                    console.log(`[SYNC] Downloading ${mod.name} from ${mod.downloadUrl}...`);
                    await downloadFile(mod.downloadUrl, targetFilePath).catch(e => {
                        console.error(`[SYNC ERROR] Failed to download ${mod.name}:`, e);
                    });
                }

                // Update UI bar roughly
                const progressPercent = Math.round((current / totalMods) * 100);
                safeSend('update-status', `Syncing Mods: ${progressPercent}%`);
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
                        const localHash = await getFileHash(targetFilePath, fileObj.hashAlgorithm || inferHashAlgorithm(fileObj.hash));
                        if (localHash === fileObj.hash) {
                            needsDownload = false;
                        }
                    } else {
                        // Without hash, default to skip if exists
                        needsDownload = false;
                    }
                }

                if (needsDownload && fileObj.downloadUrl) {
                    safeSend('update-status', `Syncing File ${current}/${totalFiles}: ${path.basename(fileObj.path)}`);
                    console.log(`[SYNC] Downloading ${fileObj.extract ? 'and extracting ' : ''}file ${fileObj.path} from ${fileObj.downloadUrl}...`);
                    await downloadFile(fileObj.downloadUrl, targetFilePath).catch(e => {
                        console.error(`[SYNC ERROR] Failed to download ${fileObj.path}:`, e);
                    });

                    if (fileObj.extract && fs.existsSync(targetFilePath)) {
                        try {
                            const extract = require('extract-zip');
                            const targetExtractDir = fileObj.path ? path.join(rootPath, fileObj.path) : rootPath;
                            safeSend('update-status', `Extracting ${path.basename(fileObj.path)}...`);
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
                safeSend('update-status', `Syncing Assets: ${progressPercent}%`);
            }
        }
    } catch (syncError) {
        console.error("Sync Engine Error:", syncError);
        dbg('sync phase failed', { error: syncError.message, stack: syncError.stack });
        safeSend('update-status', 'Warning: Sync Engine encountered an error.');
        await new Promise(r => setTimeout(r, 2000));
    }

    // Engine Launch happens strictly outside the Try/Catch block
    try {
        dbg('engine phase started');
        const loaderType = (manifest.modLoader || 'vanilla').toLowerCase();
        let targetLoader = loaders[loaderType];
        dbg('resolved loader type', { loaderType, loaderFound: !!targetLoader });

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
            safeSend('update-status', `Resolving ${resolvedVersion} version...`);
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

        if (loaderType === 'neoforge') {
            const versionParts = String(resolvedVersion).split('.').map((part) => Number.parseInt(part, 10));
            const major = versionParts[0] || 0;
            if (major > 1) {
                const launchError = `NeoForge packs require a Minecraft 1.x version, but this pack resolved to ${resolvedVersion}. Update the manifest to a 1.x release version.`;
                safeSend('update-status', 'Error: Unsupported NeoForge version.');
                safeSend('launch-error', {
                    title: 'Unsupported NeoForge Version',
                    message: launchError
                });
                throw new Error(launchError);
            }
        }

        safeSend('update-status', `Initializing ${resolvedVersion} Engine...`);
        dbg('requesting launchConfig from loader', { resolvedVersion, rootPath });
        const launchConfig = await targetLoader.getMCLCLaunchConfig({
            gameVersion: resolvedVersion,
            rootPath: rootPath
        });

        // Use requested RAM or fallback to default
        const savedConfig = loadConfig();
        const ramSetting = configRequest && configRequest.ram ? configRequest.ram : savedConfig.ram;
        dbg('RAM setting resolved', { requested: configRequest && configRequest.ram, saved: savedConfig.ram, final: ramSetting });
        
        let activeAuth = savedConfig.authProfile;
        dbg('auth profile presence', {
            hasAuthProfile: !!savedConfig.authProfile,
            authType: savedConfig.authType,
            authName: savedConfig.authProfile && savedConfig.authProfile.name
        });

        if (!activeAuth || !activeAuth.name) {
            // Re-check bypass specifically before throwing auth error in prod 
            if (!devConfig.bypassAuth) {
                throw new Error("No connected account found. Please log in first.");
            }
            activeAuth = await Authenticator.getAuth("DevTester");
            activeAuth = JSON.parse(JSON.stringify(activeAuth));
        }

        // Ensure portable Java is ready
        safeSend('update-status', `Preparing Java ${getRequiredJavaVersion(resolvedVersion)}...`);
        dbg('fetching portable java', resolvedVersion);
        const javaPath = await getJavaPortable(resolvedVersion, dbg);
        dbg('portable java ready', { javaPath, exists: fs.existsSync(javaPath) });

        let opts = {
            ...launchConfig,
            authorization: activeAuth, 
            javaPath: javaPath,
            memory: { max: `${ramSetting}G`, min: "2G" }
        };
        dbg('final launch options summary', {
            javaPath: opts.javaPath,
            memory: opts.memory,
            hasAuthorization: !!opts.authorization,
            authPlayer: opts.authorization && opts.authorization.name,
            rootPath
        });

        const progressPhases = {
            'classes': { start: 0, end: 15 },
            'assets': { start: 15, end: 45 },
            'libraries': { start: 45, end: 85 },
            'forge': { start: 85, end: 95 },
            'fabric': { start: 85, end: 95 },
            'natives': { start: 95, end: 100 }
        };
        let fallbackPercent = 0;
        let progressInterval = null; // Track artificial progress interval
        const canRenderAssetBar = !!(process.stdout && process.stdout.isTTY);
        let assetBarActive = false;
        let lastAssetBarPercent = -1;
        let lastAssetBarRenderAt = 0;

        const clearAssetBar = () => {
            if (!canRenderAssetBar || !assetBarActive) {
                return;
            }
            process.stdout.write('\n');
            assetBarActive = false;
        };

        const startArtificialProgress = () => {
            // If progress gets stuck, artificially increment to 100%
            if (progressInterval) clearInterval(progressInterval);
            
            progressInterval = setInterval(() => {
                if (fallbackPercent < 100) {
                    fallbackPercent = Math.min(100, fallbackPercent + 2);
                    safeSend('update-status', `Preparing Engine: ${Math.round(fallbackPercent)}%`);
                }
                if (fallbackPercent >= 100) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                }
            }, 300);
        };

        const stopArtificialProgress = () => {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
        };

        const renderAssetBar = (task, total, force = false) => {
            if (!canRenderAssetBar || !total || total <= 0) {
                return;
            }

            const percent = Math.max(0, Math.min(100, Math.floor((task / total) * 100)));
            const now = Date.now();
            if (!force && percent === lastAssetBarPercent && (now - lastAssetBarRenderAt) < 100) {
                return;
            }

            const width = 28;
            const filled = Math.round((percent / 100) * width);
            const bar = `${'='.repeat(filled)}${'-'.repeat(width - filled)}`;

            assetBarActive = true;
            lastAssetBarPercent = percent;
            lastAssetBarRenderAt = now;

            process.stdout.write(`\rAssets download [${bar}] ${String(percent).padStart(3)}% (${task}/${total})`);
            if (force && percent >= 100) {
                clearAssetBar();
            }
        };

        launcher.on('progress', (e) => {
            // Removed verbose dbg logging to reduce console spam
            // dbg('launcher progress event', e);

            const phaseType = e.type ? e.type.toLowerCase() : '';
            if (phaseType === 'assets') {
                renderAssetBar(e.task || 0, e.total || 0);
            } else {
                clearAssetBar();
            }

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

            // Start artificial progress if we hit 45% and no more events
            if (fallbackPercent >= 45 && !progressInterval) {
                startArtificialProgress();
            }

            // Re-capitalize the first letter for UI cleanliness
            const displayType = e.type ? e.type.charAt(0).toUpperCase() + e.type.slice(1) : 'Engine';
            safeSend('update-status', `Checking ${displayType}: ${Math.round(percent)}%`);
        });

        launcher.on('download-status', (e) => {
            // Removed verbose dbg logging to reduce console spam
            // dbg('launcher download-status event', e);
            const shortName = e.name ? (e.name.length > 50 ? '...' + e.name.slice(-50) : e.name) : 'files...';
            // Also append the overall engine progress so the UI bar stays accurate and moving
            safeSend('update-status', `Downloading: ${shortName} ${Math.round(fallbackPercent)}%`);
        });

        launcher.on('data', (e) => {
            // Store output for crash analysis
            gameOutputLog.push(e);
            if (gameOutputLog.length > MAX_OUTPUT_LINES) {
                gameOutputLog.shift();
            }
            
            // Send logs to renderer
            safeSend('game-log', `[GAME] ${e}`);
            
            // Detect dependency errors in real-time
            if (e.includes('Missing or unsupported mandatory dependencies')) {
                const depErrors = parseDependencyErrors(e);
                if (depErrors.length > 0) {
                    console.error('[DEPENDENCY ERROR] Detected mod dependency conflicts:', depErrors);
                    safeSend('dependency-error', {
                        type: 'neoforge-version-mismatch',
                        errors: depErrors,
                        raw: e
                    });
                }
            }
            
            // Only log important game output, not every line
            if (e.includes("Setting user:")) {
                 stopArtificialProgress();
                 fallbackPercent = 100;
                 safeSend('update-status', 'Game is running! 100%');
            }
            // Removed console.log for every data event to reduce spam
        });

        launcher.on('debug', (e) => {
            // Send debug logs to renderer
            safeSend('game-log', `[DEBUG] ${e}`);
        });

        launcher.on('arguments', (e) => {
            // Send arguments logs to renderer
            safeSend('game-log', `[ARGS] ${e}`);
        });

        launcher.on('error', (e) => {
            clearAssetBar();
            stopArtificialProgress();
            safeSend('game-log', `[ERROR] ${e}`);
            console.error(`[${launchTraceId}] [GAME ERROR EVENT]`, e);
        });
        
        launcher.on('close', (e) => {
            clearAssetBar();
            stopArtificialProgress();
            const exitCode = typeof e === 'number' ? e : (e && typeof e.code === 'number' ? e.code : -1);
            console.log("Game exited with code:", exitCode);
            // Removed verbose dbg logging for close event
            // dbg('launcher close event payload', e);

            if (exitCode === 0) {
                console.log("Game session ended cleanly.");
            } else {
                safeSend('update-status', `Game closed unexpectedly (code ${exitCode}).`);
                dbg('non-zero exit detected', { exitCode });
                
                // Log crash with output context
                const fullOutput = gameOutputLog.join('\n');
                const dependencyErrors = parseDependencyErrors(fullOutput);
                if (dependencyErrors.length > 0 || fullOutput.includes('Missing or unsupported mandatory dependencies')) {
                    const crashPath = writeCrashLog('GAME_CRASH_DEPENDENCY', `Game crashed with exit code ${exitCode}. Dependency errors detected.`, '', {
                        exitCode,
                        hasDependencyErrors: true,
                        dependencyCount: dependencyErrors.length
                    });
                    // Send crash info to renderer with dependency details
                    safeSend('game-crash-with-deps', {
                        exitCode,
                        dependencyErrors,
                        crashLogPath: crashPath
                    });
                } else {
                    writeCrashLog('GAME_CRASH', `Game crashed with exit code ${exitCode}.`, '', { exitCode });
                }
            }

            safeSend('game-closed');
            activeGameProcess = null;
            gameOutputLog = []; // Clear output log after game closes
        });

        activeGameProcess = await launcher.launch(opts);
        console.log("Game process started.", activeGameProcess && activeGameProcess.pid ? `PID: ${activeGameProcess.pid}` : '');
        dbg('launcher.launch resolved', {
            hasProcess: !!activeGameProcess,
            pid: activeGameProcess && activeGameProcess.pid,
            spawnfile: activeGameProcess && activeGameProcess.spawnfile,
            spawnargs: activeGameProcess && activeGameProcess.spawnargs
        });

        if (activeGameProcess) {
            activeGameProcess.on('error', (procErr) => {
                console.error(`[${launchTraceId}] [PROCESS ERROR]`, procErr);
            });

            activeGameProcess.on('spawn', () => {
                dbg('child process spawn event fired');
            });

            if (activeGameProcess.stdout) {
                activeGameProcess.stdout.on('data', (chunk) => {
                    console.log(`[${launchTraceId}] [STDOUT] ${chunk.toString().trim()}`);
                });
            }

            if (activeGameProcess.stderr) {
                activeGameProcess.stderr.on('data', (chunk) => {
                    console.error(`[${launchTraceId}] [STDERR] ${chunk.toString().trim()}`);
                });
            }
        }

    } catch (engineError) {
        console.error("Engine Launch Error:", engineError);
        dbg('engine phase failed', {
            message: engineError && engineError.message,
            stack: engineError && engineError.stack,
            name: engineError && engineError.name
        });
        safeSend('update-status', 'Error: Engine failed to launch.');
        safeSend('launch-error', {
            title: 'Engine Launch Failed',
            message: engineError && engineError.message ? engineError.message : 'Unable to start the game.'
        });
        safeSend('game-closed'); // Reset UI if failed
    }
});
