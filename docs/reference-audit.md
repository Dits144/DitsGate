# Audit referensi

- **OBSERVED** `https://qrisgate.web.id/`: landing berisi hero, fitur, alur, harga, FAQ, navigasi responsif, dan tema. Di 390px menu berubah menjadi drawer.
- **OBSERVED** `/login`: form email/password, tampilkan password, reset password; desktop dua kolom, mobile satu kolom.
- **OBSERVED** `/register`: indikator tiga langkah dan validasi persetujuan legal.
- **OBSERVED** `/docs` dan `/integrations`: contoh API multi-bahasa dengan tab dan tombol salin.
- **OBSERVED** `/dashboard` tanpa sesi mengarahkan ke `/login`. Tidak ada bypass atau pembuatan akun.
- **PROVIDED**, bukan diamati: menu, metrik, dan riwayat saldo dashboard pada brief pengguna.
- **NOT VERIFIED**: layout dashboard terlindungi, integrasi provider, backend, dan transaksi pembayaran sebenarnya.

DitsGate memakai identitas visual orisinal. Tidak ada klaim pixel parity terhadap halaman terlindungi.

## Audit backend (sesi publik)
- **OBSERVED** `/dashboard/bank-accounts` mengalihkan ke `/login?redirect=%2Fdashboard%2Fbank-accounts`; browser hanya memperlihatkan formulir login, bukan rekening.
- **OBSERVED** REA `inspect-web-page` dan browser publik hanya dapat mengamati halaman login pada sesi tanpa akun. Playwright CLI dipasang untuk inspeksi, tanpa kontrak API privat yang terbukti.
- **NOT VERIFIED** semua route dashboard berizin, field/aturan rekening, mutasi bank, status transaksi, webhook, dan signature pembayaran.
- **IMPLEMENTATION CHOICE** API di `server/` adalah sandbox lokal terpisah. Frontend masih menggunakan localStorage, belum terhubung ke API. Tidak ada pembayaran, settlement, deteksi mutasi, webhook, atau status `paid` nyata.
- Untuk kesetaraan perilaku dibutuhkan sesi akun yang berwenang dan kontrak API resmi atau rekaman akses berizin yang disanitasi. Jangan kirim password lewat chat.

## Shopee Partner (brief lanjutan)
- **OBSERVED** `https://qrisgate.web.id/docs` menjelaskan pembuatan transaksi QRISGate melalui `POST /api/v1/transactions`, nominal `base_amount` + `unique_code`, checkout URL, serta webhook dengan HMAC atas timestamp + `.` + byte body mentah. Dokumentasi publik tersebut **tidak** mendokumentasikan verifikasi token portal Shopee Partner atau endpoint daftar transaksi Shopee.
- **PROVIDED** teks layar detektor Shopee Partner, termasuk klaim “Terhubung”, riwayat pemeriksaan, token dari portal, dan opsi login akun. Itu bukan bukti sesi atau integrasi berfungsi pada proyek ini.
- **NOT VERIFIED** dashboard privat dan kontrak integrasi resmi Shopee Partner. Belum ada polling transaksi Shopee, OAuth resmi, atau koneksi provider live di DitsGate.
- **IMPLEMENTATION CHOICE** `/dashboard/detectors/shopee` mempertahankan hirarki layar dan panduan, namun menunjukkan status *Belum terhubung*; input token sesi dan aksi koneksi dinonaktifkan agar tidak menangkap kredensial tanpa verifier server yang sah. Tombol Segarkan hanya memperbarui waktu tampilan lokal. `/dashboard/admin` adalah panel operasional demo yang secara eksplisit membedakan data localStorage dari mutasi live.
- **OBSERVED** browser lokal di 758×426 menampilkan halaman Shopee dan Admin tanpa horizontal overflow; Playwright desktop 1440×900 dan mobile 390×844 melewati tes route/interaksi terkait. Ini bukan pembandingan visual terhadap dashboard privat.

## Koreksi desain admin & detektor
- **OBSERVED** `https://partner.shopee.co.id/settings/account` tanpa sesi berwenang mengalihkan ke halaman login Shopee Partner. Konten akun merchant tidak dibaca, dan tidak ada klaim bahwa portal menyediakan API merchant publik.
- **PROVIDED** pengguna menjelaskan model bisnis: saldo merchant dikenai Rp100 per transaksi yang berhasil; top-up memakai QRIS admin; admin mengelola daftar user/merchant dan saldo. Kontrak settlement belum diberikan.
- **IMPLEMENTATION CHOICE** tanpa API Shopee yang terdokumentasi, hindari scraping portal/token sesi atau klaim deteksi live. Alternatif yang mungkin hanya integrasi berizin (mis. notifikasi aplikasi milik merchant) dengan atribusi nominal/order dan mitigasi duplikat; push notification saja bukan bukti final dana masuk.
- **IMPLEMENTATION CHOICE** alur top-up dipisahkan menjadi permintaan **pending** dan kredit saldo yang hanya dapat diproses setelah verifikasi sumber dana oleh admin berwenang. Menampilkan QR statis admin memerlukan aset QR resmi; jangan mencetak QR fiktif atau mengkredit hanya karena permintaan dibuat.
- **NOT VERIFIED** kecocokan notifikasi Shopee terhadap settlement rekening, pencocokan order, identitas merchant portal, dan QRIS admin untuk produksi. UI demo lokal tidak mempunyai autentikasi admin server-side; backend lokal memerlukan pengujian terpisah sebelum deployment.
