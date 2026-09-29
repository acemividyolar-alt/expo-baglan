# expo-baglan

Telefonunuz ile bilgisayarınız **farklı internetteyken** (ör. telefon mobil veride, PC ev Wi-Fi'ında) Expo Go'ya bağlanmanızı sağlar.

## Nasıl çalışır?

Normalde `npx expo start`, telefonun bilgisayara yerel ağ IP'si (192.168.x.x) üzerinden bağlanmasını bekler. Bu yüzden iki cihaz aynı ağda değilse bağlantı kurulamaz.

`expo-baglan` şunları yapar:

1. **Cloudflare Quick Tunnel** açar. Ücretsizdir ve hesap gerektirmez. Bilgisayarınızdaki Metro sunucusu, `https://...trycloudflare.com` adresi üzerinden internete açılır.
2. Expo'yu bu adresle başlatır (`EXPO_PACKAGER_PROXY_URL`). Böylece manifest ve JS paketi tünel üzerinden sunulur.
3. Tünelin dışarıdan gerçekten erişilebildiğini test eder, ardından **QR kodunu** hem terminale basar hem de tarayıcıdaki kontrol panelinde gösterir.

`cloudflared` bilgisayarda yoksa ilk çalıştırmada Cloudflare'ın resmi GitHub sürümünden `%USERPROFILE%\.expo-baglan\` klasörüne bir kez indirilir (~60 MB).

## Kurulum (bir kere)

GitHub'dan (Git kurulu olması gerekmez):

```bash
npm install -g https://github.com/acemividyolar-alt/expo-baglan/archive/refs/heads/main.tar.gz
```

Git kuruluysa kısa hali de olur: `npm install -g github:acemividyolar-alt/expo-baglan`

Ya da indirdiğiniz `expo-baglan` klasörünün içinde terminal açıp:

```bash
npm install -g .
```

Bu komut `expo-baglan` komutunu her yerde kullanılabilir yapar. Klasörden kurduysanız ve klasörü taşırsanız kurulumu tekrarlayın.

## Kullanım

VS Code'da Expo projenizi açın, terminalde:

```bash
expo-baglan
```

- Tarayıcıda bir kontrol paneli açılır. Üç durum göstergesi yeşil olunca QR kodu görünür.
- **Android:** Expo Go > *Scan QR code*
- **iPhone:** Kamera uygulamasıyla okutun
- QR okutamazsanız: Expo Go > *Enter URL manually* > paneldeki `exps://...` adresini yapıştırın.

Expo'nun kısayolları (`r` yenile, `j` debugger vb.) aynı terminalde normal çalışır. Kapatmak için `Ctrl+C` yeterli; tünel de otomatik kapanır.

### Seçenekler

| Komut | Açıklama |
|---|---|
| `expo-baglan C:\yol\projem` | Başka klasördeki projeyi başlatır |
| `expo-baglan -c` | Metro önbelleğini temizleyerek başlatır |
| `expo-baglan --port 8090` | Farklı port kullanır (varsayılan 8081, doluysa sıradaki boş port) |
| `expo-baglan --ngrok` | Cloudflare yerine Expo'nun kendi ngrok tünelini kullanır |
| `expo-baglan --no-browser` | Kontrol panelini otomatik açmaz |
| `expo-baglan -- --max-workers 2` | `--` sonrası her şey `expo start`'a aynen iletilir |

## Sorun giderme

- **iPhone'da "You need to be signed in to Expo Go and Expo CLI" / giriş hatası**: Expo SDK 57 ile gelen kural: iPhone'daki Expo Go, bilgisayardaki Expo CLI ile **aynı Expo hesabında** oturum açılmadan projeyi açmıyor (Android şimdilik etkilenmiyor). Hesabınız yoksa [expo.dev/signup](https://expo.dev/signup) adresinden ücretsiz açın, sonra:
  1. Bilgisayarda: `npx expo login` (kontrol: `npx expo whoami`)
  2. iPhone'da: Expo Go > sağ üstteki profil simgesi > aynı hesapla giriş
  3. Hata ekranında *Try Again*'e basın.
  `expo-baglan` girişi otomatik kontrol eder, giriş yoksa terminalde ve panelde uyarır.
- **"Project is incompatible with this version of Expo Go"**: Telefondaki Expo Go sürümü projenin SDK sürümüyle uyuşmuyor. Kontrol panelinin sağ üstünde projenin SDK sürümü yazar. Expo Go'yu güncelleyin ya da projeyi `npx expo install expo@latest --fix` ile yükseltin.
- **İlk açılış yavaş**: İlk seferde paketin derlenmesi 1-2 dakika sürebilir, sonraki açılışlar hızlıdır.
- **Tünel açılamıyor**: Şirket/okul ağları Cloudflare tünellerini engelleyebilir. `expo-baglan --ngrok` deneyin ya da telefonun hotspot'una bağlanın.
- **Adres her seferinde değişiyor**: Hesapsız Quick Tunnel'ın doğası bu. Her başlatmada yeni QR'ı okutun.
- **Güvenlik**: Tünel açıkken adresi bilen herkes geliştirme sunucunuza erişebilir. Adres rastgeledir ve paylaşılmadığı sürece tahmin edilmesi zordur. İşiniz bitince `Ctrl+C` ile kapatın.
