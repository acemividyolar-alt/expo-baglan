'use strict';

const http = require('http');
const QRCode = require('qrcode');

/**
 * Tarayıcıda açılan küçük kontrol paneli: büyük QR kodu, bağlantı adresi ve canlı durum.
 * Yalnızca bu bilgisayardan (127.0.0.1) erişilebilir.
 */
function startDashboard(port, getState) {
  let qrCache = { text: null, svg: null };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/api/state') {
      const state = { ...getState() };
      if (state.expoUrl) {
        if (qrCache.text !== state.expoUrl) {
          qrCache = {
            text: state.expoUrl,
            svg: await QRCode.toString(state.expoUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
          };
        }
        state.qrSvg = qrCache.svg;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(state));
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(PAGE);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bulunamadı');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const PAGE = /* html */ `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expo Bağlan</title>
<style>
  :root {
    --bg: #f4f5f7; --card: #ffffff; --text: #1b1d22; --muted: #646b78; --line: #e3e6eb;
    --accent: #4630eb; --on-accent: #ffffff; --ok: #1a7f37; --ok-bg: #e6f4ea; --wait: #9a6700; --wait-bg: #fff4d6;
    --bad: #c62828; --bad-bg: #fdecea; --code: #f0f1f4;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111317; --card: #1a1d23; --text: #e9ebef; --muted: #9aa1ad; --line: #2b2f37;
      --accent: #8b7bff; --on-accent: #0e0b24; --ok: #4ac26b; --ok-bg: #16301f; --wait: #e3b341; --wait-bg: #342a10;
      --bad: #ff6b6b; --bad-bg: #3a1b1b; --code: #242830;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 28px 16px 48px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
  h1 span { color: var(--accent); }
  .project { color: var(--muted); font-size: 14px; }
  .grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
  .qr { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 320px; text-align: center; }
  .qr svg { width: 100%; max-width: 280px; height: auto; background: #fff; border-radius: 10px; padding: 6px; }
  .spinner { width: 42px; height: 42px; border: 4px solid var(--line); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.9s linear infinite; margin-bottom: 14px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .pill { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; font-size: 14px; }
  .pill b { font-weight: 600; }
  .pill.ok { background: var(--ok-bg); color: var(--ok); }
  .pill.wait { background: var(--wait-bg); color: var(--wait); }
  .pill.bad { background: var(--bad-bg); color: var(--bad); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; flex: none; }
  .urlrow { display: flex; gap: 8px; margin: 6px 0 4px; }
  .urlrow code { flex: 1; min-width: 0; overflow-wrap: anywhere; background: var(--code); padding: 9px 11px;
    border-radius: 8px; font: 13px/1.4 ui-monospace, "Cascadia Code", Consolas, monospace; }
  button { border: 0; background: var(--accent); color: var(--on-accent); border-radius: 8px; padding: 0 14px;
    font: inherit; font-weight: 600; cursor: pointer; }
  button:active { transform: translateY(1px); }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  ol { margin: 0; padding-left: 20px; }
  li { margin: 3px 0; }
  .note { margin-top: 16px; padding: 11px 13px; border-radius: 10px; background: var(--wait-bg); color: var(--wait); font-size: 13.5px; }
  .muted { color: var(--muted); font-size: 13px; }
  .error { white-space: pre-wrap; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Expo <span>Bağlan</span></h1>
    <div class="project" id="project"></div>
  </header>
  <div class="grid">
    <section class="card qr" id="qr">
      <div class="spinner"></div>
      <div>Tünel hazırlanıyor...</div>
    </section>
    <section class="card">
      <div class="status" id="status"></div>
      <div id="urlbox" hidden>
        <div class="muted">Expo Go bağlantı adresi</div>
        <div class="urlrow"><code id="url"></code><button id="copy" type="button">Kopyala</button></div>
      </div>
      <h2>Telefondan bağlanma</h2>
      <ol>
        <li><b>Android:</b> Expo Go'yu açın, <i>Scan QR code</i> ile soldaki kodu okutun.</li>
        <li><b>iPhone:</b> Kamera uygulamasıyla kodu okutun, çıkan Expo Go bildirimine dokunun. Expo Go'da bilgisayardakiyle <i>aynı</i> Expo hesabına giriş yapmış olmalısınız (SDK 57+).</li>
        <li>QR okutamıyorsanız Expo Go'da <i>Enter URL manually</i> seçip adresi yapıştırın.</li>
      </ol>
      <div class="note">Terminaldeki Expo QR kodu da aynı tünele gider. Bu sayfadaki kod ise bağlantının tamamını HTTPS ile kurar ve yalnızca tünel doğrulandıktan sonra görünür.</div>
      <p class="muted" id="footer"></p>
    </section>
  </div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';');
  let lastQr = null;

  function pill(state, label, detail) {
    const cls = state === true ? 'ok' : state === false ? 'bad' : 'wait';
    return '<div class="pill ' + cls + '"><span class="dot"></span><span><b>' + label + '</b> ' + detail + '</span></div>';
  }

  function render(s) {
    $('project').textContent = s.projectName ? s.projectName + (s.sdkVersion ? ' · Expo ' + s.sdkVersion : '') : '';

    const tunnelDetail = s.publicUrl ? 'açık' : 'açılıyor...';
    const metroDetail = s.metroOk ? 'çalışıyor' : 'başlatılıyor...';
    const remoteDetail = s.remoteOk ? 'internetten erişilebiliyor' : s.metroOk ? 'kontrol ediliyor...' : 'bekleniyor';
    $('status').innerHTML =
      pill(s.publicUrl ? true : s.error ? false : null, 'Cloudflare tüneli', tunnelDetail) +
      pill(s.metroOk ? true : null, 'Expo (Metro)', metroDetail) +
      pill(s.remoteOk ? true : null, 'Dış erişim', remoteDetail) +
      (s.loginRequired
        ? s.expoUser
          ? pill(true, 'Expo hesabı', esc(s.expoUser) + " (iPhone'da da bu hesap)")
          : s.expoUser === null
            ? pill(false, 'Expo hesabı:', "giriş yok. iPhone için terminalde <code>npx expo login</code> çalıştırın")
            : pill(null, 'Expo hesabı', 'kontrol edilemedi')
        : '') +
      (s.error ? pill(false, 'Hata:', '<span class="error"></span>') : '');
    if (s.error) $('status').querySelector('.error').textContent = s.error;

    if (s.expoUrl) {
      $('urlbox').hidden = false;
      $('url').textContent = s.expoUrl;
    }

    if (s.qrSvg && s.remoteOk) {
      if (lastQr !== s.qrSvg) {
        $('qr').innerHTML = s.qrSvg + '<p class="muted">Expo Go ile okutun</p>';
        lastQr = s.qrSvg;
      }
    } else if (s.error) {
      $('qr').innerHTML = '<div>Bağlantı kurulamadı. Terminaldeki mesaja bakın.</div>';
      lastQr = null;
    } else {
      const msg = !s.publicUrl ? 'Tünel hazırlanıyor...' : !s.metroOk ? 'Expo başlatılıyor...' : 'Dış erişim kontrol ediliyor...';
      if (lastQr !== msg) {
        $('qr').innerHTML = '<div class="spinner"></div><div>' + msg + '</div>';
        lastQr = msg;
      }
    }

    $('footer').textContent = s.stopped
      ? 'Expo kapatıldı. Tekrar başlatmak için terminalde expo-baglan komutunu çalıştırın.'
      : 'Adres her başlatmada değişir. İlk açılışta paketin derlenmesi 1-2 dakika sürebilir.';
  }

  async function tick() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      render(await res.json());
    } catch {
      $('footer').textContent = 'expo-baglan kapalı. Terminalde tekrar çalıştırın.';
    }
  }

  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('url').textContent);
      $('copy').textContent = 'Kopyalandı';
      setTimeout(() => ($('copy').textContent = 'Kopyala'), 1500);
    } catch {}
  });

  tick();
  setInterval(tick, 2000);
</script>
</body>
</html>`;

module.exports = { startDashboard };
