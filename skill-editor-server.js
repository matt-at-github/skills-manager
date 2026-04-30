#!/usr/bin/env node
/**
 * Skill editor server for claude-instructions-map-2.html
 * Run: node ~/.claude/skill-editor-server.js
 * Then open: http://localhost:7842
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const url = require('url');

const PORT = 7842;
const HOME = os.homedir();
const HTML_FILE = path.join(HOME, 'claude-instructions-map-2.html');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function expandUser(p) {
    if (!p) return p;
    if (p === '~') return HOME;
    if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
    return p;
}

function realpathSafe(p) {
    try {
        return fs.realpathSync(p);
    } catch (e) {
        // Fall back to resolving parent dir + basename so non-existent files
        // can still be path-checked (mirrors os.path.realpath behavior).
        try {
            const parent = fs.realpathSync(path.dirname(p));
            return path.join(parent, path.basename(p));
        } catch (e2) {
            return path.resolve(p);
        }
    }
}

function isAllowed(p) {
    if (!p) return false;
    const real = realpathSafe(expandUser(p));
    const homeReal = realpathSafe(HOME);
    return real.startsWith(homeReal + path.sep) && real.endsWith('.md');
}

function sendError(res, code, message) {
    const headers = Object.assign(
        { 'Content-Type': 'text/plain; charset=utf-8' },
        CORS_HEADERS
    );
    res.writeHead(code, headers);
    res.end(message || String(code));
}

function sendJson(res, code, obj) {
    const headers = Object.assign(
        { 'Content-Type': 'application/json' },
        CORS_HEADERS
    );
    res.writeHead(code, headers);
    res.end(JSON.stringify(obj));
}

function logReq(req, status) {
    const addr = req.socket.remoteAddress || '-';
    console.log(`  ${addr} "${req.method} ${req.url}" ${status}`);
}

async function serveHtml(req, res) {
    try {
        const content = await fsp.readFile(HTML_FILE);
        const headers = Object.assign(
            { 'Content-Type': 'text/html; charset=utf-8' },
            CORS_HEADERS
        );
        res.writeHead(200, headers);
        res.end(content);
        logReq(req, 200);
    } catch (e) {
        sendError(res, 500, e.message);
        logReq(req, 500);
    }
}

async function readFileEndpoint(req, res, filePath) {
    if (!isAllowed(filePath)) {
        sendError(res, 403, 'Path not allowed');
        logReq(req, 403);
        return;
    }
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        sendJson(res, 200, { content });
        logReq(req, 200);
    } catch (e) {
        if (e.code === 'ENOENT') {
            sendError(res, 404, 'File not found');
            logReq(req, 404);
        } else {
            sendError(res, 500, e.message);
            logReq(req, 500);
        }
    }
}

async function writeFileEndpoint(req, res, filePath, content) {
    if (!isAllowed(filePath)) {
        sendError(res, 403, 'Path not allowed');
        logReq(req, 403);
        return;
    }
    try {
        await fsp.writeFile(filePath, content, 'utf8');
        sendJson(res, 200, { ok: true });
        logReq(req, 200);
    } catch (e) {
        sendError(res, 500, e.message);
        logReq(req, 500);
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || '/';

    try {
        if (req.method === 'OPTIONS') {
            res.writeHead(200, CORS_HEADERS);
            res.end();
            logReq(req, 200);
            return;
        }

        if (req.method === 'GET') {
            if (pathname === '/' || pathname === '') {
                await serveHtml(req, res);
            } else if (pathname === '/read') {
                const p = (parsed.query && parsed.query.path) || '';
                const filePath = Array.isArray(p) ? p[0] : p;
                await readFileEndpoint(req, res, filePath);
            } else {
                sendError(res, 404, 'Not Found');
                logReq(req, 404);
            }
            return;
        }

        if (req.method === 'POST') {
            if (pathname === '/write') {
                const body = await readBody(req);
                let data;
                try {
                    data = JSON.parse(body);
                } catch (e) {
                    sendError(res, 400, 'Invalid JSON');
                    logReq(req, 400);
                    return;
                }
                await writeFileEndpoint(
                    req,
                    res,
                    data.path || '',
                    data.content || ''
                );
            } else {
                sendError(res, 404, 'Not Found');
                logReq(req, 404);
            }
            return;
        }

        sendError(res, 405, 'Method Not Allowed');
        logReq(req, 405);
    } catch (e) {
        sendError(res, 500, e.message);
        logReq(req, 500);
    }
});

server.listen(PORT, 'localhost', () => {
    console.log(`Skill editor server → http://localhost:${PORT}`);
    console.log(`Serving: ${HTML_FILE}`);
    console.log('Ctrl+C to stop.');
});

process.on('SIGINT', () => {
    console.log('\nStopped.');
    server.close(() => process.exit(0));
    // Force exit if server.close hangs on open connections.
    setTimeout(() => process.exit(0), 500).unref();
});
