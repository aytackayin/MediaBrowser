# MediaBrowser

MediaBrowser is a high-performance and modern desktop application developed to manage, edit, and play your local media files (images, videos, audio).

## 🤖 AI-Powered Development

**90%** of this project was developed on the **Antigravity** platform using **Gemini 3.1 Flash/Pro** and **Claude 4.5/4.6 Opus** AI models with a smart pair-programmer approach. AI support was utilized in every stage of the project, from design to complex Rust backend logic.

## 🛠️ Tech Stack

*   **Backend:** [Rust](https://www.rust-lang.org/) (For speed and security)
*   **Web Framework:** [Tauri v2](https://v2.tauri.app/) (Lightweight and secure desktop infrastructure)
*   **Frontend:** [React 19](https://react.dev/) & [TypeScript](https://www.typescriptlang.org/)
*   **Database:** [SQLite](https://www.sqlite.org/) (Metadata and notes management with sqlx)
*   **Media Processing:** [FFmpeg](https://ffmpeg.org/) (Thumbnail generation, video editing, and conversion)
*   **Styling:** Vanilla CSS (Rich aesthetics and modern glassmorphism)
*   **Animation:** [Framer Motion](https://www.framer.com/motion/)

## ✨ Application Features

### 1. Browser (Media Browser)
Lists media files and folders within added galleries in a modern grid layout. Offers SQLite-backed fast search, filtering (videos only, images only, etc.), and sorting features. Basic file management operations like info viewing, copying, moving, and deleting are performed here.

![MediaBrowser](assets/MediaBrowser.png)
![FileFolderActions](assets/FileFolderActions.png)

### 2. MediaPlayer
A media player with modern and sleek controls supporting all popular video and audio formats. Offers automatic subtitle detection and manual subtitle addition support.

![MediaPlayer](assets/MediaPlayer.png)

### 3. ImageEditor
Allows you to make basic adjustments to your images. You can change settings like brightness, contrast, saturation, exposure, and color temperature with real-time preview and export the edited versions.

![ImageEditor](assets/ImageEditor.png)

### 4. VideoEditor
Enables you to edit your videos on a timeline. Features include trimming, speed control (various modes), and rich visual effects (sepia, blur, dehaze, vibrance, etc.).

![VideoEditor](assets/VideoEditor.png)

### 5. VideoConverter
A tool used to convert your video files to different formats and resolutions. Utilizes the power of FFmpeg to provide fast and high-quality conversion.

![VideoConverter](assets/VideoConverter.png)

### 6. Settings / Add Gallery
Allows you to add local folders on your device as galleries to the application. Each added gallery creates its own metadata database for fast access.

![AddGallery](assets/AddGallery.png)

### 7. DeletionMethods (Secure Delete)
Does not just delete your files but also destroys them securely so they cannot be retrieved. Supports secure deletion methods such as Gutmann, DoD 5220.22-M, NSA, and other military standards.

![DeletionMethod](assets/DeletionMethod.png)

### 8. Language Support
MediaBrowser currently supports Turkish and English. Thanks to the JSON-based `locales` structure, the application can be easily translated into other languages by adding new language files.

## 🚀 Installation

### 📥 Quick Try (Downloads)
If you just want to try the application without building it, you can download the ready-to-use versions from the [setups](setups/) folder:

*   [**Portable Version (.exe)**](setups/MediaBrowser_Portable.exe): Best for quick trial. No installation required. Runs directly.
*   [**Setup Installer (.exe)**](setups/MediaBrowser_Setup.exe): Standard Windows installer.
*   [**MSI Installer (.msi)**](setups/MediaBrowser_Setup.msi): Enterprise/Standard Windows installer package.

### 🔐 SHA256 Checksum
You can verify the integrity of the downloaded files using the following SHA256 hashes:

| File | SHA256 Checksum |
| :--- | :--- |
| **MediaBrowser_Portable.exe** | `EFB2DF0C2F8CD073E70AF5505C63FDB20F60E34C4D212E4A3193EC625DC4EEFC` |
| **MediaBrowser_Setup.exe** | `251644165264B21E689DF80C874E7DC14C61F59063BF630DC852D58B24428B55` |
| **MediaBrowser_Setup.msi** | `19D8BCE1943739894EA963DC67C70010F82158058F6ECBB8815C193DA8D56447` |

---

### Local Development
Follow these steps to run or build the application locally.

### Prerequisites
-   **Node.js:** v18+
-   **Rust:** v1.75+ (Cargo must be installed)
-   **FFmpeg:** Must be added to the system PATH.
-   **Windows Build Tools:** (Visual Studio C++ Build Tools)

### Steps

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run in Development Mode:**
    ```bash
    npm run tauri dev
    ```

3.  **Build the Application:**
    ```bash
    npm run tauri build
    ```

---
*Developed with 💖 using AI and Human Collaboration.*
