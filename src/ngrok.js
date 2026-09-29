'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { TOOL_DIR, c, log } = require('./utils');

const NGROK_SPEC = '@expo/ngrok@^4.1.0';

/**
 * Expo CLI, global kurulu @expo/ngrok'u Windows'ta bulamıyor: global klasörü öğrenmek için
 * `npm.cmd`'yi kabuksuz çalıştırıyor (güncel Node bunu EINVAL ile engelliyor) ve yedek olarak
 * var olmayan %LOCALAPPDATA%\npm'e bakıyor. Sonuç: kurulum bitse bile "Install @expo/ngrok and
 * try again" hatası. Doğru klasörleri NODE_PATH ile verince Expo'nun require.resolve'u onları da tarar.
 */
function npmGlobalRoot() {
  try {
    const out = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, windowsHide: true });
    return out.trim() || null;
  } catch {
    return null;
  }
}

const hasNgrok = (dir) => fs.existsSync(path.join(dir, '@expo', 'ngrok', 'package.json'));

/** @expo/ngrok'un bulunabileceği node_modules klasörlerini döndürür; hiçbirinde yoksa aracın klasörüne kurar. */
function ensureNgrokModulePaths() {
  const localRoot = path.join(TOOL_DIR, 'node_modules');
  const paths = [npmGlobalRoot(), localRoot].filter(Boolean);
  if (paths.some(hasNgrok)) return paths;

  log.info(`${NGROK_SPEC} bir kerelik kuruluyor ${c.dim(`(${TOOL_DIR})`)}...`);
  try {
    fs.mkdirSync(TOOL_DIR, { recursive: true });
    execSync(`npm install --prefix "${TOOL_DIR}" --no-audit --no-fund ${NGROK_SPEC}`, { stdio: 'inherit', windowsHide: true });
  } catch {
    log.warn("@expo/ngrok kurulamadı; Expo kurmayı kendisi önerecek.");
  }
  return paths;
}

module.exports = { ensureNgrokModulePaths };
