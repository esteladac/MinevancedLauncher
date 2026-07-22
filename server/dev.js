const fs = require('fs');
const path = require('path');
const https = require('https');
const selfsigned = require('selfsigned');

const certDir = path.join(__dirname, 'data');
const keyPath = path.join(certDir, 'dev-key.pem');
const certPath = path.join(certDir, 'dev-cert.pem');

function generateCerts() {
    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
    }

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        };
    }

    console.log('Generating self-signed certificate...');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
            { name: 'subjectAltName', altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
            ]},
        ],
    });

    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
    console.log('Certificate generated.');

    return { key: pems.private, cert: pems.cert };
}

const certs = generateCerts();

const { app } = require('./src/index.js');

const PORT = parseInt(process.env.PORT || '8443', 10);

const server = https.createServer(certs, app);

server.listen(PORT, () => {
    console.log(`\nMinevanced dev server running on https://localhost:${PORT}`);
    console.log(`Admin panel: https://localhost:${PORT}/admin`);
    console.log('Note: Self-signed cert - browser will show security warning.\n');
});
