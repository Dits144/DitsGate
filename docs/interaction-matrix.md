# Interaction matrix

| Area | Aksi | Respons demo | Verifikasi |
|---|---|---|---|
| Navigasi | Buka rute langsung | Halaman memiliki judul dan tidak overflow di 390/1440px | Playwright: 20 rute |
| Mobile | Buka menu | Drawer memuat 18 tautan | Browser manual |
| Tema | Toggle | Root dan surface berganti gelap/terang | Browser manual |
| Transaksi | Buat sesi Rp 50.000 | Status pending, fee Rp 100 ditahan, checkout demo | Playwright desktop/mobile |
| Transaksi | Reload | Data lokal bertahan | Playwright desktop/mobile |
| Admin demo | Tandai expired | Fee Rp 100 dikembalikan, checkout berubah status | Playwright desktop/mobile |
| QRIS | Upload PNG/JPEG | Pratinjau lokal; bukan validasi/decode payload | Implemented, belum E2E |
| Developer | Login sandbox, buat/cabut dg_test_, simpan URL webhook/QRIS per-key, rotasi secret | Backend terautentikasi, key di-hash; nilai mentah hanya di memori tab selama ≤60 detik; tanpa pengiriman/ping outbound atau deteksi Shopee | Node API 12 tes, typecheck/build, Playwright 26 tes desktop/mobile lulus; alur UI memakai mock API, health server lokal 200 |
| ShopeePay resmi | Login merchant dan baca konfigurasi backend; masukkan referensi/nominal | `checkAvailable:false`: tombol uji nonaktif meski env terisi; semua referensi ditolak 409 hingga order ShopeePay terikat merchant dan verifikasi signature resmi tersedia. Token portal tidak dipakai | Node 18 tes, Playwright desktop/mobile; tidak ada panggilan API ShopeePay live atau pembayaran terverifikasi |
| Autentikasi | Masuk demo | Buka workspace tanpa autentikasi produksi | Implemented, belum E2E |

**NOT VERIFIED:** setiap cabang form, aksesibilitas seluruh dialog dan semua tema di seluruh rute. Tidak ada transaksi, webhook, atau otorisasi produksi.
