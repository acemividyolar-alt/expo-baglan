'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

/** Verilen klasörden yukarı doğru, bağımlılıklarında "expo" olan package.json'u arar. */
function findExpoProject(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.expo) return { root: dir, pkg };
      } catch {
        // Bozuk package.json: aramaya devam et.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Projenin kendi node_modules'undaki Expo CLI giriş dosyası (npx/shell gerektirmeden çalıştırmak için). */
function findLocalExpoCli(projectRoot) {
  let dir = projectRoot;
  for (;;) {
    const pkgPath = path.join(dir, 'node_modules', 'expo', 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.expo;
        const cli = path.join(dir, 'node_modules', 'expo', bin || 'bin/cli');
        if (fs.existsSync(cli)) return { cli, version: pkg.version };
      } catch {
        // devam
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * `expo start`'ı çalıştırır. Terminal girişi/çıkışı doğrudan Expo'ya bağlı olduğu için
 * r (yenile), j (debugger), ? gibi Expo kısayolları normal şekilde çalışır.
 */
function startExpo({ projectRoot, cli, port, proxyUrl, useNgrok, clear, extraArgs, nodePaths = [] }) {
  const args = ['start', '--port', String(port), '--go'];
  if (useNgrok) args.push('--tunnel');
  if (clear) args.push('--clear');
  args.push(...extraArgs);

  const env = { ...process.env };
  if (proxyUrl) {
    // Expo'nun QR kodu, manifest ve bundle adreslerinin hepsi bu genel adrese göre üretilir.
    env.EXPO_PACKAGER_PROXY_URL = proxyUrl;
  } else {
    delete env.EXPO_PACKAGER_PROXY_URL;
  }
  if (nodePaths.length) {
    env.NODE_PATH = [...nodePaths, env.NODE_PATH].filter(Boolean).join(path.delimiter);
  }

  return spawn(process.execPath, [cli, ...args], { cwd: projectRoot, env, stdio: 'inherit' });
}

/**
 * Expo CLI'de oturum açmış kullanıcıyı döndürür: kullanıcı adı, giriş yoksa null, belirlenemezse undefined.
 * SDK 57'den itibaren iPhone'daki Expo Go, CLI ile aynı hesapta oturum açılmadan projeyi açmaz.
 */
function getExpoUser(projectRoot, cli) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, 'whoami'],
      { cwd: projectRoot, timeout: 30000, windowsHide: true, env: { ...process.env, CI: '1' } },
      (err, stdout, stderr) => {
        const out = `${stdout || ''}\n${stderr || ''}`;
        if (/not logged in/i.test(out)) return resolve(null);
        const name = String(stdout || '').trim().split(/\r?\n/).pop();
        resolve(!err && name ? name : undefined);
      }
    );
  });
}

module.exports = { findExpoProject, findLocalExpoCli, startExpo, getExpoUser };
