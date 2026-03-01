# MediaBrowser

MediaBrowser, yerel medya dosyalarınızı (resim, video, ses) yönetmek, düzenlemek ve oynatmak için geliştirilmiş, yüksek performanslı ve modern bir masaüstü uygulamasıdır. 

## 🤖 AI Destekli Geliştirme

Bu projenin **%90'ı**, **Antigravity** platformu üzerinde **Gemini 3.1 Flash/Pro** ve **Claude 4.5/4.6 Opus** yapay zeka modelleri tarafından, akıllı bir eş-programcı (pair-programmer) yaklaşımıyla geliştirilmiştir. Tasarımdan karmaşık Rust backend mantığına kadar projenin her aşamasında yapay zeka desteğinden yararlanılmıştır.

## 🛠️ Kullanılan Teknolojiler

*   **Backend:** [Rust](https://www.rust-lang.org/) (Hız ve güvenlik için)
*   **Web Framework:** [Tauri v2](https://v2.tauri.app/) (Hafif ve güvenli masaüstü altyapısı)
*   **Frontend:** [React 19](https://react.dev/) & [TypeScript](https://www.typescriptlang.org/)
*   **Database:** [SQLite](https://www.sqlite.org/) (sqlx ile metadata ve not yönetimi)
*   **Medya İşleme:** [FFmpeg](https://ffmpeg.org/) (Thumbnail üretimi, video düzenleme ve dönüştürme)
*   **Styling:** Vanilla CSS (Zengin estetik ve modern cam efektleri)
*   **Animasyon:** [Framer Motion](https://www.framer.com/motion/)

## ✨ Uygulama Özellikleri

### 1. Browser (Medya Tarayıcı)
Uygulamaya eklenen galeriler içindeki medya dosyalarını ve klasörleri modern bir ızgara yapısında listeler. SQLite destekli hızlı arama, filtreleme (sadece video, resim vb.) ve sıralama özellikleri sunar. Dosyalar üzerinde bilgi görme, kopyalama, taşıma ve silme gibi temel dosya yönetimi işlemleri buradan yapılır.

![MediaBrowser](assets/MediaBrowser.png)
![FileFolderActions](assets/FileFolderActions.png)

### 2. MediaPlayer
Tüm popüler video ve ses formatlarını destekleyen, modern ve şık kontrollere sahip medya oynatıcı. Otomatik altyazı tespiti ve manuel altyazı ekleme desteği sunar.

![MediaPlayer](assets/MediaPlayer.png)

### 3. ImageEditor
Resimleriniz üzerinde temel düzenlemeler yapmanızı sağlar. Parlaklık, kontrast, doygunluk, pozlama, renk sıcaklığı gibi ayarları gerçek zamanlı önizleme ile değiştirebilir ve düzenlenmiş hallerini dışa aktarabilirsiniz.

![ImageEditor](assets/ImageEditor.png)

### 4. VideoEditor
Videolarınızı timeline (zaman çizelgesi) üzerinde düzenlemenize olanak tanır. Kırpma (trim), hız ayarı (speed control modları) ve zengin görsel efektler (sepia, blur, dehaze, vibrance vb.) uygulama yeteneklerine sahiptir.

![VideoEditor](assets/VideoEditor.png)

### 5. VideoConverter
Video dosyalarınızı farklı formatlara ve çözünürlüklere dönüştürmek için kullanılan araçtır. FFmpeg gücünü kullanarak hızlı ve kaliteli dönüştürme sağlar.

![VideoConverter](assets/VideoConverter.png)

### 6. Settings / Add Gallery
Cihazınızdaki yerel klasörleri galeri olarak uygulamaya eklemenizi sağlar. Eklenen her galeri kendi metadata veritabanını oluşturarak hızlı erişim sağlar.

![AddGallery](assets/AddGallery.png)

### 7. DeletionMethods (Güvenli Silme)
Dosyalarınızı sadece silmekle kalmaz, isterseniz geri getirilemeyecek şekilde güvenli olarak imha eder. Gutmann, DoD 5220.22-M, NSA ve diğer askeri standartlarda güvenli silme yöntemlerini destekler.

![DeletionMethod](assets/DeletionMethod.png)

### 8. Language Support (Dil Desteği)
MediaBrowser şu an için Türkçe ve İngilizce dillerini desteklemektedir. JSON tabanlı `locales` yapısı sayesinde yeni dil dosyaları eklenerek uygulama kolayca farklı dillere çevrilebilir.

## 🚀 Kurulum

### 📥 Hızlı Deneyim (İndirme Bağlantıları)
Uygulamayı derlemeden doğrudan denemek isterseniz, [setups](setups/) klasöründeki hazır kurulum dosyalarını indirebilirsiniz:

*   [**Portable Sürüm (.exe)**](setups/MediaBrowser_Portable.exe): Kurulum gerektirmez, doğrudan çalışır. Hızlıca denemek için en iyisidir.
*   [**Standart Kurulum (.exe)**](setups/MediaBrowser_Setup.exe): Standart Windows yükleyicisidir.
*   [**MSI Paketi (.msi)**](setups/MediaBrowser_Setup.msi): Kurumsal veya standart Windows yükleyici paketidir.

### 🔐 SHA256 Checksum
İndirdiğiniz dosyaların güvenliğini ve bütünlüğünü aşağıdaki SHA256 anahtarlarıyla kontrol edebilirsiniz:

| Dosya Adı | SHA256 Karşılaştırma Özeti (Hash) |
| :--- | :--- |
| **MediaBrowser_Portable.exe** | `EFB2DF0C2F8CD073E70AF5505C63FDB20F60E34C4D212E4A3193EC625DC4EEFC` |
| **MediaBrowser_Setup.exe** | `251644165264B21E689DF80C874E7DC14C61F59063BF630DC852D58B24428B55` |
| **MediaBrowser_Setup.msi** | `19D8BCE1943739894EA963DC67C70010F82158058F6ECBB8815C193DA8D56447` |

## 🛡️ Güvenlik Şeffaflığı (VirusTotal Taraması)

Tüm dağıtılan ikili dosyalar release sırasında VirusTotal'e manuel olarak yüklenmiş ve taranmıştır.

| Dosya | Tespit Sonucu | Notlar |
|------|------------------|-------|
| MediaBrowser_Portable.exe | 1 / 72 | Tekil ML-tabanlı tespit (Trapmine) |
| MediaBrowser_Setup.exe | 0 / 72 | Temiz |
| MediaBrowser_Setup.msi | 0 / 72 | Temiz |

### Detaylar

- Tüm ana antivirüs sağlayıcıları (Microsoft, Kaspersky, BitDefender, ESET, Avast, Malwarebytes, Sophos, vb.) **Tespit Edilmedi** (Undetected) raporu vermiştir.
- Portable sürümdeki tekil tespit, otomatik makine öğrenimi motorundan (Trapmine ML) kaynaklanmaktadır.
- ML-tabanlı tespitler, yeni oluşturulmuş veya dijital olarak imzalanmamış uygulamalarda yaygındır ve genellikle "false positive" (hatalı pozitif) durumudur.
- Proje tamamen açık kaynaklıdır ve bu dosyaları oluşturmak için kullanılan kaynak kodları bu depoda mevcuttur.

### Tam Raporlar

- Portable:  
  https://www.virustotal.com/gui/file/efb2df0c2f8cd073e70af5505c63fdb20f60e34c4d212e4a3193ec625dc4eefc?nocache=1

- Setup (.exe):  
  https://www.virustotal.com/gui/file-analysis/NGEzZDNjZmM4YzgxMjRlMjk3YjM5MmYzMjljYWYyZGM6MTc3MjM3NTAxMQ==

- MSI Kurulum Paketi:  
  https://www.virustotal.com/gui/file-analysis/MDg2YTI2ZjE2ZjBkYWQwNjcyYzI0NDE5ZDQyNTUyYmQ6MTc3MjM3NTE2OA==

> Not: Uygulama henüz dijital bir kod imzalama sertifikasına sahip olmadığı için Windows SmartScreen uyarıları görünebilir. Bu, ticari imza sertifikası olmayan bağımsız/açık kaynaklı projeler için beklenen bir durumdur.

---

### Yerel Geliştirme
Uygulamayı yerelinizde çalıştırmak veya derlemek için aşağıdaki adımları izleyin.

### Ön Gereksinimler
-   **Node.js:** v18+ 
-   **Rust:** v1.75+ (Cargo yüklü olmalı)
-   **FFmpeg:** Sistem yoluna (PATH) eklenmiş olmalıdır.
-   **Windows Build Tools:** (Visual Studio C++ Build Tools)

### Adımlar

1.  **Bağımlılıkları Yükleyin:**
    ```bash
    npm install
    ```

2.  **Geliştirme Modunda Çalıştırın:**
    ```bash
    npm run tauri dev
    ```

3.  **Uygulamayı Derleyin (Build):**
    ```bash
    npm run tauri build
    ```

---
*Developed with 💖 using AI and Human Collaboration.*
