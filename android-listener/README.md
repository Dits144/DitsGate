# DitsGate Android notification listener — source lokal

**Bukan integrasi API Shopee Partner.** Aplikasi ini hanya mengirim *sinyal notifikasi yang belum terverifikasi* dari satu aplikasi Android yang dipilih pemilik perangkat ke backend DitsGate lokal. Tidak melunasi order, tidak memulihkan `SESSION_BROKEN`, dan tidak mengakses portal Shopee. Jangan masukkan token sesi Shopee, password, atau data akun. Gunakan hanya pada perangkat dan notifikasi yang Anda berwenang baca.

## Persiapan

1. Di `D:/Projects/DitsGate`, jalankan `npm run api` dan `npm run dev` di dua terminal. Masuk ke `http://127.0.0.1:5179/dashboard/detectors/shopee`, klik **Pasangkan listener**, dan salin token perangkat `dt_...` yang hanya tampil sekali.
2. Build APK debug lokal dengan JDK 17+ dan Android SDK Platform 35, Build Tools 35.0.0, serta Gradle 8.11.1. Terima lisensi Android SDK sendiri bila Anda setuju. Build APK debug (`:app:assembleDebug`) dan pasang pada perangkat Android 8+ milik Anda. Tidak ada APK release atau signing key di repositori; APK debug dihasilkan dengan signing debug resmi Android. File hasil build ada di `app/build/outputs/apk/debug/app-debug.apk` (debug-signed).
3. Untuk uji USB dengan backend yang terikat di `127.0.0.1:5180`, aktifkan USB debugging dan jalankan `adb reverse tcp:5180 tcp:5180` pada perangkat terhubung. Ini meneruskan alamat `127.0.0.1:5180` **dari perangkat** ke localhost PC. Isi URL `http://127.0.0.1:5180/api/v1/mutations/ingest` pada app debug. HTTP ditolak untuk host selain localhost; release Android menonaktifkan cleartext. Untuk perangkat tanpa USB diperlukan backend HTTPS yang Anda kendalikan, bukan URL localhost PC.
4. Isi **package aplikasi sumber** yang benar dari perangkat Anda (contoh dalam dokumentasi QRISGate: `com.gojek.gopaymerchant`; *contoh, bukan bukti package Shopee Partner*). Isi token `dt_...` (ditampilkan sekali oleh dashboard, lalu dipakai berulang oleh perangkat sampai dicabut), tekan **Simpan & aktifkan**, lalu tekan **Buka izin akses notifikasi Android** dan setujui akses OS secara sadar. Aplikasi ini akan memperoleh izin Android membaca seluruh notifikasi; implementasi hanya memproses package yang cocok persis, namun tetap gunakan perangkat khusus yang Anda kontrol.
5. Setelah notifikasi dari package terpilih datang, lihat `Pengiriman terakhir` di app dan klik **Segarkan sinyal** di dashboard. Server menyimpan hash teks notifikasi dan nominal yang diparse untuk tampilan saja. Respons `200/202` berarti sinyal diterima, **bukan pembayaran terverifikasi**.
6. Untuk menghentikan, klik **Nonaktifkan & hapus token lokal**, cabut izin Notification Access di pengaturan Android, dan **Cabut token perangkat** di dashboard. Cabut di server supaya token lama tidak dapat digunakan.

## Protokol & batas

- Hanya `source_app`, `title`, `text` yang dikirim ke `POST /api/v1/mutations/ingest`. `X-Device-Token` membuktikan perangkat memegang token, bukan kebenaran notifikasi. `X-Event-Id` adalah ekstensi idempotensi lokal yang dihitung SHA-256 dari notification key + waktu posting + payload; ulang kirim event identik dengan ID sama dideduplikasi server, sedangkan pembaruan teks notifikasi mendapat ID berbeda.
- Konten notifikasi tidak disimpan oleh app; token terenkripsi menggunakan AES-GCM Android Keystore dan tidak di-backup. App tidak menulis token ke log. Endpoint dan package tersimpan dalam preferensi privat. Tidak ada akses clipboard otomatis.
- Implementasi awal ini **tidak memiliki antrean retry tahan restart**. Saat offline/gagal kirim, sinyal dapat hilang. Android juga dapat membatasi proses background. Tidak ada jaminan deteksi semua pembayaran; rekonsiliasi wajib memakai bukti provider yang sah dan pemeriksaan order/nominal terpisah.
- Aplikasi ini **belum siap produksi**: perlu HTTPS terverifikasi, pembatasan laju, antrean retry terbatas, attestation perangkat, rotasi token, penanganan notifikasi sensitif, observabilitas, dan uji pada perangkat nyata. Jangan expose backend lokal tanpa hardening.

## Tes tanpa Android SDK

Di root repo, dengan Java 17+:

```sh
javac -d D:/hermes/cache/scratch/ditsgate-listener-classes android-listener/app/src/main/java/id/ditsgate/listener/SignalFormatter.java android-listener/app/src/main/java/id/ditsgate/listener/SignalSender.java android-listener/tests/SignalFormatterTest.java android-listener/tests/SignalSenderTest.java
java -cp D:/hermes/cache/scratch/ditsgate-listener-classes id.ditsgate.listener.SignalFormatterTest
java -cp D:/hermes/cache/scratch/ditsgate-listener-classes id.ditsgate.listener.SignalSenderTest
```

Tes tersebut memverifikasi format, filter package, URL aman, pengiriman HTTP lokal, header dan respons 401, **bukan** build/install Android. Build penuh dan uji perangkat perlu SDK, persetujuan lisensi, serta perangkat/emulator.
