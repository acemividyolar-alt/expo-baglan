#!/usr/bin/env node
'use strict';

const path = require('path');
const QRCode = require('qrcode');
const { c, log, findFreePort, openBrowser, checkPackagerStatus, sleep } = require('../src/utils');
const { ensureCloudflared, startQuickTunnel } = require('../src/cloudflared');
const { findExpoProject, findLocalExpoCli, startExpo, getExpoUser } = require('../src/expo');
const { startDashboard } = require('../src/dashboard');

const HELP = `
${c.bold('expo-baglan')} - Telefon ve bilgisayar farklı internetteyken Expo Go'ya bağlanır.

${c.bold('Kullanım:')}
  expo-baglan [proje-klasörü] [seçenekler] [-- ek expo start argümanları]

${c.bold('Seçenekler:')}
  --port <n>      Metro portu (varsayılan: 8081, doluysa sıradaki boş port)
  -c, --clear     Metro önbelleğini temizleyerek başlat
  --ngrok         Cloudflare yerine Expo'nun kendi ngrok tünelini kullan (expo start --tunnel)
  --no-browser    Kontrol panelini tarayıcıda otomatik açma
  -h, --help      Bu yardımı göster

${c.bold('Örnekler:')}
  expo-baglan                      (VS Code terminalinde, proje klasöründeyken)
  expo-baglan C:\\projeler\\uygulamam
  expo-baglan -c
`;

function parseArgs(argv) {
  const opts = { dir: process.cwd(), port: 8081, clear: false, ngrok: false, browser: true, extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts.extra = argv.slice(i + 1);
      break;
    } else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-c' || a === '--clear') opts.clear = true;
    else if (a === '--ngrok') opts.ngrok = true;
    else if (a === '--no-browser') opts.browser = false;
    else if (a === '--port') {
      opts.port = Number(argv[++i]);
      if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error('--port geçerli bir sayı olmalı.');
    } else if (a.startsWith('-')) throw new Error(`Bilinmeyen seçenek: ${a}  (yardım için: expo-baglan --help)`);
    else opts.dir = path.resolve(a);
  }
  return opts;
}

async function printQr(text) {
  const qr = await QRCode.toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
  console.log(qr);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const project = findExpoProject(opts.dir);
  if (!project) {
    log.error(`Expo projesi bulunamadı: ${opts.dir}`);
    log.info('VS Code terminalinde Expo projenizin klasörüne geçip tekrar deneyin, ya da klasörü argüman olarak verin.');
    process.exitCode = 1;
    return;
  }

  const expoCli = findLocalExpoCli(project.root);
  if (!expoCli) {
    log.error('Projede "expo" paketi yüklü değil (node_modules eksik).');
    log.info(`Önce proje klasöründe şunu çalıştırın: ${c.cyan('npm install')}`);
    process.exitCode = 1;
    return;
  }

  const sdkMajor = expoCli.version.split('.')[0];
  log.info(`Proje: ${c.bold(project.pkg.name || path.basename(project.root))}  ${c.dim(`(Expo SDK ${sdkMajor}, ${project.root})`)}`);

  // SDK 57+: iPhone'daki Expo Go, CLI ve uygulama aynı Expo hesabıyla giriş yapmadan projeyi açmıyor.
  const loginRequired = Number(sdkMajor) >= 57;
  const expoUser = loginRequired ? await getExpoUser(project.root, expoCli.cli) : undefined;
  if (expoUser === null) {
    log.warn('Bu bilgisayarda Expo hesabına giriş yapılmamış! iPhone bağlanamaz.');
    log.info(`Çözüm: yeni bir terminalde ${c.cyan('npx expo login')} çalıştırın, sonra iPhone'da Expo Go > sağ üstteki profil simgesi > aynı hesapla giriş yapın.`);
    log.info(c.dim('(Android şimdilik bundan etkilenmez. Giriş yaptıktan sonra bu aracı yeniden başlatmanıza gerek yok.)'));
  } else if (expoUser) {
    log.ok(`Expo hesabı: ${c.bold(expoUser)}  ${c.dim("(iPhone'daki Expo Go'da da bu hesapla giriş yapılmış olmalı)")}`);
  }

  // --- ngrok modu: Expo'nun kendi tüneline aynen devret ---
  if (opts.ngrok) {
    log.info("Expo'nun ngrok tüneli kullanılıyor. Bu modda Expo'nun terminalde bastığı QR kodu doğrudur.");
    const expo = startExpo({ projectRoot: project.root, cli: expoCli.cli, port: opts.port, useNgrok: true, clear: opts.clear, extraArgs: opts.extra });
    expo.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  // --- Cloudflare modu ---
  const state = {
    projectName: project.pkg.name || path.basename(project.root),
    sdkVersion: `SDK ${sdkMajor}`,
    loginRequired,
    expoUser,
    publicUrl: null,
    expoUrl: null,
    metroOk: false,
    remoteOk: false,
    error: null,
    stopped: false,
  };

  const metroPort = await findFreePort(opts.port);
  if (metroPort !== opts.port) log.warn(`${opts.port} portu dolu, ${metroPort} kullanılacak.`);

  const dashPort = await findFreePort(19555);
  const dashboard = await startDashboard(dashPort, () => state);
  const dashUrl = `http://127.0.0.1:${dashPort}`;
  log.info(`Kontrol paneli: ${c.cyan(dashUrl)}`);
  if (opts.browser) openBrowser(dashUrl);

  let bin;
  try {
    bin = await ensureCloudflared();
  } catch (err) {
    state.error = err.message;
    log.error(err.message);
    log.info(`Alternatif olarak Expo'nun kendi tünelini deneyin: ${c.cyan('expo-baglan --ngrok')}`);
    dashboard.close();
    process.exitCode = 1;
    return;
  }

  log.info('Cloudflare tüneli açılıyor (hesap gerekmez)...');
  const recent = [];
  const tunnel = startQuickTunnel(bin, metroPort, {
    onLog: (line) => {
      recent.push(line);
      if (recent.length > 25) recent.shift();
    },
  });

  let expo = null;
  let shuttingDown = false;

  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    state.stopped = true;
    if (!tunnel.child.killed) tunnel.child.kill();
    if (expo && expo.exitCode === null) expo.kill();
    // Panelin "kapandı" durumunu gösterebilmesi için kısa bir süre bekle.
    setTimeout(() => {
      dashboard.close();
      process.exit(code);
    }, 300);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  try {
    state.publicUrl = await tunnel.ready;
  } catch (err) {
    state.error = err.message;
    log.error(err.message);
    if (recent.length) console.error(c.dim(recent.slice(-10).join('\n')));
    log.info(`Alternatif olarak Expo'nun kendi tünelini deneyin: ${c.cyan('expo-baglan --ngrok')}`);
    shutdown(1);
    return;
  }

  const host = new URL(state.publicUrl).host;
  state.expoUrl = `exps://${host}`;
  log.ok(`Tünel açık: ${c.cyan(state.publicUrl)}`);

  tunnel.child.on('exit', (code) => {
    if (shuttingDown) return;
    state.error = `Cloudflare tüneli kapandı (kod ${code}). expo-baglan'ı yeniden başlatın.`;
    state.remoteOk = false;
    log.error(state.error);
  });

  log.info('Expo başlatılıyor... (dış erişim doğrulanınca buraya QR kodu basılacak)');

  expo = startExpo({
    projectRoot: project.root,
    cli: expoCli.cli,
    port: metroPort,
    proxyUrl: state.publicUrl,
    clear: opts.clear,
    extraArgs: opts.extra,
  });
  expo.on('exit', (code) => shutdown(code ?? 0));
  expo.on('error', (err) => {
    log.error(`Expo başlatılamadı: ${err.message}`);
    shutdown(1);
  });

  // Durum takibi: önce yerel Metro, sonra tünel üzerinden dışarıdan erişim.
  let announced = false;
  let remoteFailures = 0;
  let loops = 0;
  while (!shuttingDown) {
    // Kullanıcı çalışırken `npx expo login` yaparsa panel güncellensin.
    if (state.expoUser === null && ++loops % 5 === 0) {
      const user = await getExpoUser(project.root, expoCli.cli);
      if (user) {
        state.expoUser = user;
        log.ok(`Expo hesabına giriş algılandı: ${c.bold(user)}. iPhone'da Expo Go'da da aynı hesapla giriş yapın.`);
      }
    }

    state.metroOk = await checkPackagerStatus(`http://127.0.0.1:${metroPort}`, 3000);
    if (state.metroOk && !state.error) {
      const ok = await checkPackagerStatus(state.publicUrl, 10000);
      state.remoteOk = ok;
      remoteFailures = ok ? 0 : remoteFailures + 1;

      if (ok && !announced) {
        announced = true;
        console.log('');
        log.ok(c.bold(c.green('Hazır! Telefon artık hangi internette olursa olsun bağlanabilir.')));
        log.info(`Expo Go adresi: ${c.bold(c.cyan(state.expoUrl))}`);
        await printQr(state.expoUrl);
        log.info(`Android: Expo Go > Scan QR code  |  iPhone: Kamera uygulaması  |  Panel: ${c.cyan(dashUrl)}`);
      } else if (!ok && remoteFailures === 10) {
        log.warn('Tünel üzerinden Metro\'ya ulaşılamıyor. İnternet bağlantınızı kontrol edin; sorun sürerse --ngrok deneyin.');
      }
    }
    await sleep(announced ? 5000 : 2000);
  }
}

main().catch((err) => {
  log.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
