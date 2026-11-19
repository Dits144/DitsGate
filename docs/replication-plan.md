# Implementasi dan validasi

1. [x] Baca brief, audit referensi publik, catat batas autentikasi.
2. [x] Bangun shell dan tokens DitsGate yang orisinal, bukan menyalin branding.
3. [x] Hubungkan landing, auth demo, merchant, admin demo, checkout, dan modul sidebar.
4. [x] Simulasikan fee Rp 100 secara deterministik dan simpan state di browser.
5. [x] Jalankan typecheck, unit test, Playwright desktop/mobile, dan build.
6. [ ] Hubungkan UI admin ke API server berotorisasi; pastikan role admin tidak dapat diambil lewat registrasi publik dan top-up tidak otomatis dikredit tanpa bukti settlement.
7. [ ] Lanjutkan modul backend produksi: autentikasi server, validasi transaksi, kredensial, verifikasi provider, webhook bertanda tangan, audit trail. Jangan deploy sebagai payment gateway sebelum tahap ini.
8. [ ] E2E lanjutan untuk unggah QRIS, bank, setting, keyboard dialog, serta visual regression seluruh tema/viewport.

**Prioritas berikutnya:** code splitting untuk bundle JavaScript >500 kB; refaktor komponen monolit `src/main.tsx`; tambah kontrak API dan integrasi nyata hanya setelah backend aman tersedia.
