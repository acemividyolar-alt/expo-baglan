'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { c, log } = require('./utils');

const TOOL_DIR = path.join(os.homedir(), '.expo-baglan');
const BIN_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const LOCAL_BIN = path.join(TOOL_DIR, BIN_NAME);
const RELEASE_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

/** Resmi Cloudflare GitHub sürümünden bu platform için indirilecek dosya adı. */
function releaseAsset() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? '386' : 'amd64';
  switch (process.platform) {
    case 'win32':
      // Windows ARM, amd64 sürümünü emülasyonla çalıştırabilir.
      return { file: `cloudflared-windows-${arch === '386' ? '386' : 'amd64'}.exe`, tgz: false };
    case 'darwin':
      return { file: `cloudflared-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}.tgz`, tgz: true };
    case 'linux':
      return { file: `cloudflared-linux-${arch}`, tgz: false };
    default:
      throw new Error(`Bu işletim sistemi desteklenmiyor: ${process.platform}`);
  }
}

function works(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`İndirme başarısız (${res.status} ${res.statusText}): ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    if (!total || !process.stdout.isTTY) return;
    const pct = Math.floor((received / total) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(`\r   indiriliyor... %${pct}  (${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`);
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  if (total && process.stdout.isTTY) process.stdout.write('\n');
}

/** cloudflared'i bulur; yoksa resmi GitHub sürümünden ~/.expo-baglan klasörüne indirir. */
async function ensureCloudflared() {
  if (process.env.CLOUDFLARED_PATH && works(process.env.CLOUDFLARED_PATH)) return process.env.CLOUDFLARED_PATH;
  if (works('cloudflared')) return 'cloudflared';
  if (fs.existsSync(LOCAL_BIN) && works(LOCAL_BIN)) return LOCAL_BIN;

  const asset = releaseAsset();
  const url = RELEASE_BASE + asset.file;
  log.info(`cloudflared bulunamadı, bir kerelik indiriliyor (Cloudflare resmi GitHub sürümü):`);
  log.info(c.dim(url));
  fs.mkdirSync(TOOL_DIR, { recursive: true });

  const tmp = path.join(TOOL_DIR, `${asset.file}.part`);
  try {
    await download(url, tmp);
    if (asset.tgz) {
      const r = spawnSync('tar', ['-xzf', tmp, '-C', TOOL_DIR], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('cloudflared arşivi açılamadı (tar hatası).');
      fs.rmSync(tmp, { force: true });
    } else {
      fs.renameSync(tmp, LOCAL_BIN);
    }
    if (process.platform !== 'win32') fs.chmodSync(LOCAL_BIN, 0o755);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }

  if (!works(LOCAL_BIN)) throw new Error(`cloudflared indirildi ama çalıştırılamadı: ${LOCAL_BIN}`);
  log.ok(`cloudflared hazır: ${c.dim(LOCAL_BIN)}`);
  return LOCAL_BIN;
}

/**
 * Hesap gerektirmeyen bir Cloudflare "quick tunnel" açar ve genel HTTPS adresini döndürür.
 * Dönen `url` telefonun her yerden erişebileceği adrestir (ör. https://kelime-kelime.trycloudflare.com).
 */
function startQuickTunnel(bin, localPort, { onLog } = {}) {
  const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${localPort}`];
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  const ready = new Promise((resolve, reject) => {
    let url = null;
    let registered = false;
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error('Cloudflare tüneli 60 saniye içinde açılamadı. İnternet bağlantınızı veya güvenlik duvarını kontrol edin.'));
    }, 60000);

    const done = () => {
      if (url && registered) {
        clearTimeout(timer);
        resolve(url);
      }
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (onLog) onLog(line);
        const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m && !url) url = m[0];
        if (/Registered tunnel connection/i.test(line)) registered = true;
        done();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared beklenmedik şekilde kapandı (kod ${code}).`));
    });
  });

  return { child, ready };
}

module.exports = { ensureCloudflared, startQuickTunnel };
