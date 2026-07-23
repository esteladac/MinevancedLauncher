/**
 * launcher-worker.js
 * Runs minecraft-launcher-core in a Worker thread so its heavy I/O
 * (file hashing, library/asset checks, downloads) never blocks the
 * main Electron process event loop.
 *
 * Messages received (parentPort → worker):
 *   { type: 'launch', opts: { ...launchOptions }, traceId: string }
 *   { type: 'kill' }
 *
 * Messages sent (worker → parentPort):
 *   { type: 'progress',     data: { type, task, total } }
 *   { type: 'download-status', data: { name, ... } }
 *   { type: 'download',     data: { type, ... } }
 *   { type: 'data',         data: string }
 *   { type: 'debug',        data: string }
 *   { type: 'arguments',    data: string }
 *   { type: 'error',        data: any }
 *   { type: 'close',        data: any }
 *   { type: 'process-info', pid: number, spawnfile: string, spawnargs: string[] }
 *   { type: 'launched',     hasProcess: boolean }
 *   { type: 'launch-failed', error: string }
 */

const { parentPort } = require('worker_threads');
const { Client } = require('minecraft-launcher-core');

let gameProcess = null;

parentPort.on('message', (msg) => {
    if (msg.type === 'kill') {
        if (!gameProcess) return;
        try {
            const { exec } = require('child_process');
            if (process.platform === 'win32' && gameProcess.pid) {
                exec(`taskkill /F /PID ${gameProcess.pid} /T`, () => {});
            } else if (!gameProcess.killed) {
                gameProcess.kill('SIGKILL');
            }
        } catch (_) {}
        return;
    }

    if (msg.type === 'launch') {
        runLaunch(msg.opts, msg.traceId);
    }
});

function runLaunch(opts, traceId) {
    const launcher = new Client();

    launcher.on('progress', (e) => {
        parentPort.postMessage({ type: 'progress', data: e });
    });

    launcher.on('download-status', (e) => {
        parentPort.postMessage({ type: 'download-status', data: e });
    });

    launcher.on('download', (e) => {
        parentPort.postMessage({ type: 'download', data: e });
    });

    launcher.on('data', (e) => {
        parentPort.postMessage({ type: 'data', data: e });
    });

    launcher.on('debug', (e) => {
        parentPort.postMessage({ type: 'debug', data: e });
    });

    launcher.on('arguments', (e) => {
        parentPort.postMessage({ type: 'arguments', data: e });
    });

    launcher.on('error', (e) => {
        parentPort.postMessage({ type: 'error', data: e ? e.toString() : String(e) });
    });

    launcher.on('close', (e) => {
        parentPort.postMessage({ type: 'close', data: e });
        gameProcess = null;
    });

    launcher.launch(opts).then((proc) => {
        gameProcess = proc;
        parentPort.postMessage({
            type: 'launched',
            hasProcess: !!proc,
            pid: proc ? proc.pid : null,
            spawnfile: proc ? proc.spawnfile : null,
            spawnargs: proc ? proc.spawnargs : null
        });
    }).catch((err) => {
        parentPort.postMessage({
            type: 'launch-failed',
            error: err && err.message ? err.message : String(err)
        });
    });
}
