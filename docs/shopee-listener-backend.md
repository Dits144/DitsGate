# ShopeePay — backend notifikasi listener (sandbox lokal)

**Batas penting:** Ini **bukan** koneksi langsung ke API Shopee Partner, bukan pemulihan `SESSION_BROKEN`, dan belum ada penerima Android yang dipasang. Server hanya menerima sinyal dari perangkat yang dipasangkan merchant. Sinyal dapat dipalsukan oleh siapa pun yang memegang token perangkat, sehingga tidak boleh otomatis menandai transaksi `paid`, memotong biaya, ataupun memicu webhook pembayaran sukses. Untuk koneksi API langsung, diperlukan akses/kontrak resmi Shopee dan verifikasi identitas merchant. Jangan memakai token sesi portal `data.metadata.token` dari DevTools.

API lokal (default `http://127.0.0.1:5180`; lihat `server/index.mjs` untuk konfigurasi):

| Metode | Path | Otorisasi | Hasil |
| --- | --- | --- | --- |
| GET | `/api/v1/shopee-listener` | Bearer sesi merchant | `unconfigured`, `awaiting_event`, atau `receiving`; `providerConnected` selalu `false` |
| POST | `/api/v1/shopee-listener` | Bearer sesi merchant | Buat token `dt_...`, hanya dikembalikan sekali; ulang ketika aktif -> 409 |
| DELETE | `/api/v1/shopee-listener` | Bearer sesi merchant | Cabut token perangkat; histori event merchant tetap ada |
| GET | `/api/v1/shopee-listener/events` | Bearer sesi merchant | Maksimal 100 event terbaru milik merchant |
| POST | `/api/v1/shopee-listener/ingest` | Bearer **token perangkat** | Terima sinyal `unverified_listener_signal` (202); replay identik 200; ID sama dengan isi berbeda 409 |

Kontrak publik QRISGate yang ditambahkan: `POST /api/v1/mutations/ingest` dengan header `X-Device-Token: dt_<token-perangkat>` dan JSON `{"source_app":"com.gojek.gopaymerchant","title":"Pembayaran diterima","text":"Kamu menerima pembayaran QRIS sebesar Rp 125.008 dari pelanggan."}`. Header opsional `X-Event-Id` memberi idempotensi pada retry (jangan kirim ID berbeda untuk notifikasi sama). Server hanya menyimpan hash teks mentah dan nominal yang diparse untuk tampilan, bukan bukti pembayaran; `providerConnected:false`. Endpoint ini lokal di DitsGate, **bukan** endpoint QRISGate live. `GET /api/v1/shopee-listener/events` kini menampilkan sinyal format baru dan lama, tetap dibatasi ke merchant.

Payload endpoint kompatibilitas lama `/api/v1/shopee-listener/ingest`: `{"eventId":"id-unik-dari-perangkat","amount":50003,"occurredAt":"2026-11-19T10:00:00.000Z","issuer":"ShopeePay"}`. `occurredAt` harus dalam rentang 24 jam dari jam server; `eventId` harus stabil pada retry. Jangan masukkan nomor akun, isi notifikasi mentah, token portal, atau password. Token disimpan hanya sebagai SHA-256 di SQLite, tidak pernah dikembalikan oleh GET. Revoke membuat token lama tidak berlaku. Semua akses tersaring berdasarkan merchant.

Status `receiving` berarti **pernah menerima sinyal dari token perangkat**, bukan status koneksi Shopee atau bukti settlement. Sebelum dipakai produksi: buat app Android NotificationListenerService dengan consent pemilik perangkat; gunakan HTTPS, pembatasan laju per perangkat, proteksi event replay yang lebih kuat, rotasi token, autentikasi/attestation perangkat, verifikasi sumber pembayaran independen, rekonsiliasi order dan nominal, penanganan ambigu, audit, serta mekanisme logout/revoke dan observabilitas. Jangan infer `paid` hanya dari teks notifikasi.

Verifikasi lokal: `node --test tests/shopee-listener.test.mjs`; seluruh suite: `node --test tests/*.test.mjs`. Backend ini tidak tersambung ke `qrisgate.web.id` dan tidak di-deploy.
