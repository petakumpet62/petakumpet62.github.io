# Build Android APK di GitHub Codespaces

Panduan ini membuat APK release lokal untuk pengujian perangkat Android. Build ini ditandatangani dengan debug keystore, bukan untuk distribusi atau rilis publik.

## Prasyarat

Build terakhir di Codespaces menggunakan Node.js 24, JDK 21, Android Build Tools 37.0.0, Android platform 37, dan NDK 27.1.12297006. JDK 25 yang mungkin menjadi default Codespace belum dipakai untuk build ini.

Di terminal Codespace, dari root repository:

```bash
cd mobile
npm ci # hanya pada Codespace baru atau setelah package-lock.json berubah

export JAVA_HOME=/usr/local/sdkman/candidates/java/21.0.13.0+2-ms
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="$HOME/.cache/petak-android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

java -version
test -x "$JAVA_HOME/bin/java"
test -d "$ANDROID_HOME/build-tools/37.0.0"
test -d "$ANDROID_HOME/platforms/android-37.0"
test -d "$ANDROID_HOME/ndk/27.1.12297006"
```

Jika direktori JDK 21 berbeda pada image Codespace lain, pilih direktori JDK 21 yang terpasang di `/usr/local/sdkman/candidates/java/`. Jika Android SDK berada di lokasi lain, sesuaikan `ANDROID_HOME`; SDK tersebut harus berisi Build Tools 37.0.0, Android platform 37, dan NDK 27.1.12297006.

## Build APK

Jalankan build di terminal Codespaces dan biarkan proses selesai. Batas satu worker dan heap yang terukur membantu menghindari tekanan resource; log disimpan agar penyebab kegagalan bisa diperiksa.
Lanjutkan dari folder `mobile/` pada terminal yang sama:

```bash
cd android
set -o pipefail

./gradlew --no-daemon --max-workers=1 \
  -Dorg.gradle.parallel=false \
  -Dorg.gradle.jvmargs='-Xmx1536m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8' \
  -Pkotlin.compiler.execution.strategy=in-process \
  app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  -Pandroid.enableMinifyInReleaseBuilds=false \
  2>&1 | tee /tmp/petak-android-release-build.log
```

APK arm64 untuk ponsel Android tersedia di:

```text
mobile/android/app/build/outputs/apk/release/app-release.apk
```

Build di atas menargetkan perangkat arm64, bukan emulator x86_64. Untuk emulator, ganti nilai `-PreactNativeArchitectures` dengan arsitektur emulator yang didukung oleh semua modul native yang dipakai.

Verifikasi APK sebelum dibagikan:

```bash
APK=app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --verbose "$APK"
sha256sum "$APK"
```

## Jika build terhenti

- Jika log berakhir dengan `Gradle build daemon disappeared unexpectedly` tanpa error kompilasi yang spesifik, jalankan kembali perintah build yang sama. Gradle dapat memakai hasil task yang sudah selesai; jangan langsung menjalankan `clean`.
- Jika kegagalan berulang terjadi pada `createBundleReleaseJsAndAssets`, jalankan task bundle terlebih dahulu dengan opsi Gradle yang sama:

  ```bash
  # Jalankan dari mobile/android.
  ./gradlew --no-daemon --max-workers=1 \
    -Dorg.gradle.parallel=false \
    -Dorg.gradle.jvmargs='-Xmx1536m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8' \
    -Pkotlin.compiler.execution.strategy=in-process \
    app:createBundleReleaseJsAndAssets \
    -PreactNativeArchitectures=arm64-v8a \
    -Pandroid.enableMinifyInReleaseBuilds=false
  ```

  Setelah task berhasil, ulangi perintah `app:assembleRelease` penuh. Jangan mengecualikan task bundle dengan `-x`; Android Gradle Plugin memerlukan task tersebut selesai untuk memetakan resource hasil generate.
- Periksa bagian akhir log dengan `tail -n 100 /tmp/petak-android-release-build.log`. Jika ada error Kotlin, Metro, atau konfigurasi yang eksplisit, perbaiki error tersebut sebelum mencoba ulang.
- Jalankan build di terminal Codespaces yang tetap terbuka; hindari menjalankan beberapa build Gradle bersamaan atau me-rebuild Codespace saat proses masih berjalan.

## Perubahan konfigurasi native

Penyesuaian konten terhadap keyboard memakai `KeyboardAvoidingView` di bundle JavaScript, sehingga bisa diuji melalui Expo Go tanpa APK. Expo Go memakai konfigurasi jendela Android dari binary host; nilai `edgeToEdgeEnabled`, `softwareKeyboardLayoutMode`, dan plugin native di `app.json` proyek tidak mengubahnya.

Folder `mobile/android/` dibuat dari konfigurasi Expo dan diabaikan Git. Build rutin tidak memerlukan prebuild. Jika konfigurasi `app.json` atau dependency native berubah, dari folder `mobile/` jalankan:

```bash
npx expo prebuild --platform android --no-install
```

Prebuild membuat ulang folder Android dan dapat menghapus APK serta cache build yang lama. Setelah itu, ulangi build APK di atas. Jika dependency berubah, pastikan `package.json` dan `package-lock.json` sudah diperbarui dan instal dependency terlebih dahulu.

## Backend dan keamanan

APK tanpa `EXPO_PUBLIC_SOCKET_URL` memakai alamat backend Android default yang ditujukan untuk emulator (`10.0.2.2:4000`). Untuk uji dari ponsel fisik, set URL HTTPS backend yang dapat dijangkau sebelum build, misalnya URL port-forwarding Codespaces yang digunakan untuk backend/proxy. `EXPO_PUBLIC_SOCKET_URL` masuk ke bundle aplikasi; jangan pernah menaruh token, password, atau rahasia di variabel `EXPO_PUBLIC_*`.

Jika `./start.sh` sudah berjalan dari root dan port proxy `8080` tersedia untuk perangkat:

```bash
export EXPO_PUBLIC_SOCKET_URL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
```

Port-forwarding publik hanya diperlukan untuk pengujian dari luar Codespace; kembalikan visibilitas port setelah selesai.

APK lokal ini memakai debug signing. Keystore hanya untuk pengujian; jangan commit atau membagikan `debug.keystore` maupun release keystore. Jika Android menolak pemasangan sebagai pembaruan karena tanda tangan berbeda, menghapus aplikasi versi lama lalu memasang APK baru dapat menyelesaikannya, tetapi akan menghapus data aplikasi di perangkat.
