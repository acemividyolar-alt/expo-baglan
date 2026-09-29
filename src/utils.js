'use strict';

const net = require('net');
const os = require('os');
const readline = require('readline');
const path = require('path');
const dns = require('dns');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

/** Aracın indirdiği/kurduğu şeylerin (cloudflared, @expo/ngrok) durduğu klasör. */
const TOOL_DIR = path.join(os.homedir(), '.expo-baglan');

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const c = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  blue: paint(34),
  magenta: paint(35),
  cyan: paint(36),
};

const PREFIX = c.magenta('[expo-baglan]');

const log = {
  info: (msg) => console.log(`${PREFIX} ${msg}`),
  ok: (msg) => console.log(`${PREFIX} ${c.green('✔')} ${msg}`),
  warn: (msg) => console.log(`${PREFIX} ${c.yellow('!')} ${c.yellow(msg)}`),
  error: (msg) => console.error(`${PREFIX} ${c.red('✖')} ${c.red(msg)}`),
};

/** Terminalde soru sorar; readline kapatılır ki stdin sonra Expo'ya temiz şekilde devredilsin. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${PREFIX} ${question}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Port boş mu? Windows'ta 0.0.0.0'a bağlanmak, başka bir sürecin 127.0.0.1'de aynı portu
 * tutmasına rağmen başarılı olabildiği için her adres ayrı ayrı denenir.
 */
async function isPortFree(port) {
  const tryListen = (host) =>
    new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', (err) => resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, host);
    });
  for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
    if (!(await tryListen(host))) return false;
  }
  return true;
}

async function findFreePort(start, tries = 50) {
  for (let port = start; port < start + tries; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`${start}-${start + tries} aralığında boş port bulunamadı.`);
}

function openBrowser(url) {
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Tarayıcı açılamazsa sorun değil, adres terminalde yazıyor.
  }
}

// Yeni açılan tünel adreslerini sorgularken Windows'un DNS önbelleğine "bulunamadı" cevabı
// takılmasın diye önce doğrudan genel DNS sunucularına sorulur, olmazsa sistem DNS'ine düşülür.
const publicResolver = new dns.Resolver({ timeout: 3000, tries: 1 });
publicResolver.setServers(['1.1.1.1', '8.8.8.8']);

function freshLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  publicResolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses.length) return dns.lookup(hostname, options, callback);
    if (options.all) return callback(null, addresses.map((address) => ({ address, family: 4 })));
    callback(null, addresses[0], 4);
  });
}

/** Metro'nun /status adresini sorgular; "packager-status:running" dönerse sunucu ayakta demektir. */
function checkPackagerStatus(baseUrl, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL('/status', baseUrl);
    } catch {
      return resolve(false);
    }
    const isHttps = target.protocol === 'https:';
    const req = (isHttps ? https : http).get(
      target,
      {
        headers: { 'user-agent': 'expo-baglan' },
        timeout: timeoutMs,
        ...(isHttps ? { lookup: freshLookup } : {}),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          if (body.length < 1000) body += d;
        });
        res.on('end', () => resolve(res.statusCode === 200 && body.includes('packager-status:running')));
        res.on('error', () => resolve(false));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    // Yanıt yarıda kesilirse 'end' gelmeyebilir; durum döngüsü asılı kalmasın.
    req.on('close', () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { TOOL_DIR, c, log, ask, findFreePort, openBrowser, checkPackagerStatus, sleep };
