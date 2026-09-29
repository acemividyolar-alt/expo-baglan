# expo-baglan: geliştirici notları

Bu dosya projeye kaldığı yerden devam etmek için yazıldı: ne yapıldı, neden böyle yapıldı, nasıl test edilir ve açık konular neler. Kullanıcı dokümanı için [README.md](README.md)'ye bakın.

## Amaç

Telefon (Expo Go) ile bilgisayar **farklı internetteyken** (ör. telefon mobil veride) Expo geliştirme sunucusuna bağlanabilmek. Normal `npx expo start` telefonun bilgisayara yerel IP (192.168.x.x) üzerinden ulaşmasını beklediği için bu durumda çalışmaz. Araç, Metro sunucusunu bir tünelle internete açar ve Expo'yu bu adresle başlatır.

Kullanım: VS Code terminalinde Expo projesinin klasöründe `expo-baglan`.

## Mevcut durum (Eylül 2026)

| Senaryo | Durum |
|---|---|
| Ev ağı, Cloudflare tüneli | ✅ Uçtan uca test edildi (manifest + 3,8 MB JS paketi tünelden indi) |
| Ev ağı, ngrok modu (`--ngrok`) | ✅ Uçtan uca test edildi (`*.exp.direct`) |
| iPhone, SDK 57 | ✅ Bilgisayar ve Expo Go **aynı Expo hesabıyla** giriş yapınca çalışıyor |
| Okul lab ağı (LAB1_PC_31/32) | ❌ Cloudflare kesin engelli (7844). ngrok "took too long to connect" verdi; otomatik tekrar deneme eklendi, **yeniden denenmedi** |

Hedef ortam: Windows 11, Node 24, VS Code (PowerShell terminali), Expo SDK 57. Kod macOS/Linux'u da hesaba katıyor ama orada test edilmedi.

## Akış

`bin/expo-baglan.js` içindeki `main()`:

1. **Proje bulma**: Klasörden yukarı doğru, bağımlılıklarında `expo` olan `package.json` aranır. Expo CLI `node_modules/expo/bin/cli` yolundan bulunur.
2. **Expo hesabı** (SDK 57+): `expo whoami` çalıştırılır. Giriş yoksa ve terminal interaktifse "Şimdi giriş yapılsın mı? [E/h]" diye sorulur, ardından `expo login` aynı terminalde açılır (kimlik bilgilerini Expo CLI sorar). `--login` ile hesap değiştirilir, `--logout` ile çıkış yapılıp program kapanır.
3. `--ngrok` verildiyse doğrudan 8. adıma geçilir.
4. Boş Metro portu (8081'den başlayarak) ve kontrol paneli portu (19555'ten başlayarak) seçilir. Panel `127.0.0.1`'de açılır ve tarayıcıda gösterilir.
5. **Engel ön kontrolü**: `region1/region2.v2.argotunnel.com:7844` ile 4 sn'lik bir TLS el sıkışması denenir (SNI `h2.cftunnel.com`, sertifikada "CloudFlare" beklenir). Başarısızsa doğrudan ngrok'a geçilir ve cloudflared indirilmez.
6. **cloudflared**: Önce `CLOUDFLARED_PATH`, sonra PATH, sonra `~/.expo-baglan/` aranır. Hiçbirinde yoksa resmi GitHub sürümü indirilir.
7. **Quick Tunnel**: Önce `--protocol http2` (TCP) denenir, olmazsa `quic` (UDP). Her deneme 20 sn sürer. `https://xxx.trycloudflare.com` adresi alınır; ikisi de başarısızsa ngrok'a geçilir.
8. **Expo başlatma**:
   - Cloudflare modunda `EXPO_PACKAGER_PROXY_URL=<tünel>` ile `expo start --port N --go` çalıştırılır (stdio inherit, böylece `r`, `j` kısayolları çalışır).
   - ngrok modunda `expo start --tunnel` çalıştırılır, `NODE_PATH` ayarlanır ve açılışta hata olursa bir kez tekrar denenir.
9. **Durum döngüsü**: Yerel `/status` ve tünel üzerinden `/status` düzenli kontrol edilir; bir durumun "kapalı" sayılması için art arda 3 başarısız kontrol gerekir. Dış erişim doğrulanınca terminale ve panele `exps://<host>` QR kodu basılır.
10. **Kapanış**: Expo çıkınca tünel kapatılır. `process.on('exit')` tüm alt süreçleri öldürür, böylece yetim cloudflared kalmaz.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `bin/expo-baglan.js` | Argümanlar, ana akış, ngrok'a geçiş/tekrar, durum döngüsü, alt süreç takibi |
| `src/cloudflared.js` | cloudflared bulma/indirme, 7844 TLS ön kontrolü, quick tunnel başlatma |
| `src/expo.js` | Proje/CLI bulma, `startExpo`, `getExpoUser` (whoami), `runExpoAuth` (login/logout) |
| `src/ngrok.js` | Expo'nun Windows'taki global paket bulma hatasına karşı `NODE_PATH` hazırlığı, gerekirse `@expo/ngrok` kurulumu |
| `src/dashboard.js` | Yerel kontrol paneli (tek HTML sayfası + `/api/state`), QR SVG |
| `src/utils.js` | Renkli log, `ask`, port bulma, tarayıcı açma, `/status` kontrolü, `TOOL_DIR` |

Tek bağımlılık `qrcode`.

## Önemli bulgular ve kararlar

Aşağıdakilerin çoğu Expo CLI kaynak kodu (`@expo/cli` 57.x) ve Expo Go kaynak kodu okunarak doğrulandı. Değiştirmeden önce nedenlerini okuyun.

- **QR adresi `exps://<host>`**
  - Expo Go (Android `ExponentUrls.toHttp`) `exp://` adresini `http://`, `exps://` adresini `https://` olarak açar. iOS Expo Go da `exps` şemasını kayıtlı tutar.
  - Expo'nun kendi terminal QR'ı proxy modunda `exp://<host>` üretir: `URL` nesnesi 443'ü varsayılan port diye siler. Bu adres de çalışır, çünkü trycloudflare port 80'de HTTP cevap veriyor. Bizim QR ise bağlantının tamamını HTTPS ile kurar.
- **`EXPO_PACKAGER_PROXY_URL`**: Expo bunu `.env` yüklenmeden önceki ortamdan okur (`getOriginalEnvValue`). Bu yüzden `.env` dosyasına yazmak işe yaramaz; alt sürecin ortamına verilmesi gerekir.
- **SDK 57 iPhone giriş şartı**: CLI, manifeste giriş yapmış kullanıcının adını koyar; iPhone'daki Expo Go kendi hesabıyla karşılaştırır. **Bu kontrolü atlatacak bir şey (ör. manifestte kullanıcı adını sahteleme) yapılmayacak.** Doğru çözüm iki tarafta aynı hesapla giriş yapmak; bu da otomatikleştirildi. Açık bir Expo hatası da var: [expo/expo#50085](https://github.com/expo/expo/issues/50085) (iOS'ta giriş hemen geri düşüyor).
- **Windows'ta Expo'nun `@expo/ngrok` bulamama hatası**: `@expo/require-utils/resolveGlobal` global klasörü öğrenmek için `npm.cmd`'yi kabuksuz çalıştırıyor, güncel Node bunu `EINVAL` ile engelliyor. Yedek olarak var olmayan `%LOCALAPPDATA%\npm` klasörüne bakıyor. Sonuç: kurulumdan hemen sonra bile "Install @expo/ngrok@^4.1.0 and try again". Çözüm: `npm root -g` ve `~/.expo-baglan/node_modules` `NODE_PATH` ile Expo'ya veriliyor; Node'un `require.resolve({paths})` çağrısı `NODE_PATH`'i de tarıyor.
- **Expo ngrok zaman aşımı**: `AsyncNgrok` içinde sabit 10 sn var, zaman aşımında tekrar denemiyor. Bu yüzden açılışta 90 sn içinde hatayla çıkarsa araç bir kez daha deniyor. Olası sebep: yeni indirilen `ngrok.exe` ilk çalıştırmada antivirüs taramasına takılıyor.
- **Okul/şirket ağları**:
  - cloudflared varsayılan olarak QUIC (UDP 7844) kullanır ve bu çoğu ağda kapalıdır. Bu yüzden http2 önce deneniyor.
  - Ön kontrolde sadece TCP bağlantısına bakmak yanıltıcı oldu: bazı ağlar ve güvenlik yazılımları her porta TCP bağlantısını kabul ediyor. Bu yüzden TLS el sıkışması ve sertifika kontrolü yapılıyor.
- **Windows'ta `.cmd` çalıştırma**: Node 18.20+/20.12+ `.cmd` ve `.bat` dosyalarını `shell: true` olmadan çalıştırmıyor (EINVAL). Bu yüzden Expo CLI `process.execPath` + `node_modules/expo/bin/cli` ile çalıştırılıyor. `npm` gereken yerlerde `execSync` (kabuklu) kullanılıyor.
- **Windows'ta port kontrolü**: `0.0.0.0`'a bağlanmak, başka bir süreç `127.0.0.1`'de aynı portu tutarken başarılı olabiliyor. Bu yüzden `127.0.0.1`, `0.0.0.0`, `::1` ve `::` ayrı ayrı deneniyor.
- **DNS önbelleği**: Yeni tünel adresleri önce `1.1.1.1`/`8.8.8.8` üzerinden çözülüyor (`freshLookup`). Böylece Windows DNS önbelleğine "bulunamadı" cevabı takılmıyor; olmazsa sistem DNS'ine düşülüyor.
- **Panel güvenliği**: `Host` başlığı yalnızca `127.0.0.1:<port>` veya `localhost:<port>` olabilir (DNS rebinding'e karşı). Tünel adresi fiilen bir sırdır: bilen herkes geliştirme sunucusuna, dolayısıyla JS paketine erişebilir. Bu Expo'nun kendi `--tunnel` özelliğiyle aynı durumdur.
- **Politika**: Kullanıcı okul filtresini "aşmak" istedi. **Filtrede henüz engellenmemiş başka tünel servisleri aramak/eklemek yapılmadı ve yapılmamalı**; bu, kurumun ağ kuralını dolanmak olur. ngrok, Expo'nun resmi tüneli ve normal HTTPS (443) kullandığı için yedek olarak kaldı. Engel devam ederse öneriler: hocadan veya ağ yöneticisinden izin, telefonu lab ile aynı Wi-Fi'a bağlamak (tünelsiz `npx expo start`), tarayıcı önizlemesi (`w`), emülatör.

## Test etme

İnteraktif olmayan bir kabukta test edilebilir; Expo o zaman QR basmaz ve soru sormaz.

```bash
# 1) Boş bir Expo test projesi (bir kerelik)
npx create-expo-app@latest testapp --template blank --yes

# 2) Cloudflare modu
node bin/expo-baglan.js <testapp yolu> --no-browser

# 3) Expo Go'nun isteğini taklit et: manifest (launchAsset.url tünel adresini göstermeli)
curl -H "expo-platform: android" -H "accept: application/expo+json,application/json" https://<tünel>/

# 4) ngrok modu
node bin/expo-baglan.js <testapp yolu> --ngrok --port 8090
```

**Engelli ağı taklit etmek** için şu içerikle bir `block-cf.js` dosyası oluşturup `NODE_OPTIONS="--require ./block-cf.js"` ile çalıştırın. Beklenen: ~4 sn'de ngrok'a geçiş.

```js
const dns = require('dns'); const orig = dns.lookup;
dns.lookup = (h, o, cb) => { if (typeof o === 'function') { cb = o; o = {}; }
  if (/argotunnel/.test(h)) return o.all ? cb(null, [{ address: '10.255.255.1', family: 4 }]) : cb(null, '10.255.255.1', 4);
  return orig(h, o, cb); };
```

**Test sonrası temizlik**: Test sürecini zorla (Stop-Process) kapatırsanız Expo'nun başlattığı `ngrok.exe` açık kalabilir. `cloudflared.exe`/`ngrok.exe` süreçlerini kontrol edin. Normal `Ctrl+C` ile kapanışta hepsi kapanır.

**Panelin ön yüzü**: `dashboard.js` içindeki `<script>` bir şablon metninin içinde olduğu için `node --check` onu görmez. Sözdizimini ayrıca kontrol edin (şablonu `eval` edip `new Function(js)` ile derlemek yeterli).

**Test edilemeyenler**: Gerçek terminalde (TTY) "Şimdi giriş yapılsın mı?" sorusu ve ardından `expo login`'in açılması test edilmedi; bu ortam TTY değildi. Gerçek telefonla test yapılmadı; kullanıcı iPhone'da çalıştığını bildirdi.

## Açık konular / sonraki adımlar

1. **Okul ağında yeniden deneme**: Otomatik ngrok tekrarı eklendi. İkinci deneme de "took too long" verirse ağ ngrok'u engelliyor demektir; o durumda yukarıdaki "Politika" maddesine bakın.
2. **Giriş sorusu**: Gerçek terminalde doğrulanmalı. Windows'ta readline kapandıktan sonra stdin'in Expo'ya sorunsuz geçtiği kontrol edilmeli.
3. **Otomatik yeniden bağlanma yok**: cloudflared oturum sırasında kapanırsa terminalde ve panelde hata gösteriliyor, yeniden başlatmak gerekiyor.
4. **Doğrulanmadı**: `~/.cloudflared/config.yml` varsa quick tunnel çalışmayabilir.
5. **Olası iyileştirme**: `package.json` sürümü hâlâ `1.0.0`; değişikliklerde artırılabilir.

## Repo ve yayınlama

- GitHub: https://github.com/acemividyolar-alt/expo-baglan. Commit e-postası GitHub'ın gizli adresi (`233408966+acemividyolar-alt@users.noreply.github.com`); bu ayar sadece bu repoda (`git config` yerel).
- `.gitignore` **yok** (kullanıcı istemedi). `git add -A` yapmayın, `node_modules` de eklenir. Dosyaları adıyla ekleyin: `git add bin src README.md AGENTS.md CLAUDE.md package.json package-lock.json`.
- Kullanıcının bilgisayarında global kurulum `D:\pain\expo-baglan` klasörüne bağlı (junction); kod değişiklikleri anında geçerli olur.
- Başka bilgisayarda kurulum (Git gerektirmez):
  ```bash
  npm install -g --prefer-online https://github.com/acemividyolar-alt/expo-baglan/archive/refs/heads/main.tar.gz
  ```
  `github:` kısa yolu Git ister; lab bilgisayarlarında Git yok.
- Mesajlar ve dokümanlar Türkçe. Kod yorumları Türkçe ve seyrek, sadece "neden" açıklanır.

## Geçmiş

1. İlk sürüm: Cloudflare quick tunnel, `exps://` QR, kontrol paneli.
2. README'ye Git gerektirmeyen kurulum komutu eklendi (lab bilgisayarında `spawn git ENOENT` hatası).
3. Lab'da QUIC engelliydi: önce http2, sonra quic, sonra ngrok sırası getirildi.
4. Hata taraması: yetim süreçler, panelin ngrok/kapanış durumları, QR titremesi, Host kontrolü, asılı kalan istek.
5. Windows'ta Expo'nun `@expo/ngrok` bulamama hatası `NODE_PATH` ile çözüldü.
6. Expo hesabı: giriş yoksa soru soruluyor; `--login` ve `--logout` eklendi.
7. 7844 TLS ön kontrolü eklendi: engelli ağda ngrok'a geçiş ~40 sn'den ~4 sn'ye indi.
8. ngrok açılışta hata verirse bir kez tekrar deneniyor; yine olmazsa tünelsiz seçenekler gösteriliyor.
