const { Client } = require('minecraft-launcher-core');

const client = new Client();

const forwardEvents = ['progress', 'download-status', 'data', 'debug', 'arguments', 'error', 'close'];
forwardEvents.forEach(event => {
    client.on(event, (data) => {
        try {
            if (process.send) process.send({ type: 'event', event, data });
        } catch (_) {}
    });
});

process.on('message', async (msg) => {
    if (msg.type === 'launch') {
        try {
            const gameProcess = await client.launch(msg.opts);
            if (process.send) process.send({ type: 'launched', pid: gameProcess.pid });
        } catch (err) {
            if (process.send) process.send({ type: 'error', message: err.message, stack: err.stack });
            process.exit(1);
        }
    } else if (msg.type === 'exit') {
        process.exit(0);
    }
});

process.on('uncaughtException', (err) => {
    try {
        if (process.send) process.send({ type: 'error', message: err.message, stack: err.stack });
    } catch (_) {}
    process.exit(1);
});
