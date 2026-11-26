# PREFIXXX Audit Report (`https://www.prefixxx.web.id/dashboard`)

**Tanggal:** 2026-11-26  
**Metode Pengujian:** Browser Subagent bawaan Antigravity (Opsi 2 atas persetujuan pengguna, sebagai pengganti sementara karena Chrome DevTools MCP belum dimuat pada sesi percakapan aktif)  
**Target:** `https://www.prefixxx.web.id/dashboard` (dan seluruh rute dashboard yang dapat diakses)

---

## Executive Summary
- **Total halaman diuji:** 20 rute dashboard + halaman publik `/`
- **Total skenario diuji:** 31 skenario (Discovery, Console/Network, Navigasi 20 rute, Interaksi Non-Destruktif, Responsive 5 viewport, Back/Forward/Reload)
- **Hasil:**
  - **PASS:** 21
  - **FAIL:** 9
  - **BLOCKED / NOT MEASURED:** 1 (`window.performance` trace metrics tidak tersedia langsung dari sandbox browser subagent)
- **Rincian Severity:**
  - **Critical:** 1 (Vercel HTTP 404 saat direct load / refresh di `/dashboard`)
  - **High:** 3 (Stuck loading `"Memuat..."` di `/dashboard/support` saat 401/error; HTTP 403 berulang untuk akun `Administrator` pada endpoint merchant-only; Role badge menampilkan `MERCHANT` untuk akun `admin`)
  - **Medium:** 3 (Mobile horizontal overflow pada `.summary-strip` di `/dashboard/transactions`; Sisa teks "Demo lokal" di `/dashboard/qris` & `/dashboard/integration-guide`; `shopee-portal/transactions` status 0 di `/dashboard/mutations`)
  - **Low:** 2 (Missing `<h1>` & missing `aria-label` tombol refresh di `/dashboard/admin`; inkonsistensi metrik KPI `Total User: 0` di `/dashboard/admin`)

---

## Bug Findings

| ID | Severity | Page | Bug | Steps to Reproduce | Evidence | Status |
|---|---|---|---|---|---|---|
| BUG-01 | Critical | `/dashboard` (semua subpath) | Direct GET atau browser refresh (`F5`) mengembalikan HTTP `404: NOT_FOUND` dari Vercel. | 1. Buka `https://www.prefixxx.web.id/dashboard` langsung atau tekan Refresh setelah masuk via SPA. | Screenshot `step_46.png`; Vercel `404: NOT_FOUND` (`sin1::wwvp9-...`). | Fixed locally (`vercel.json` ditambahkan, menunggu deploy). |
| BUG-02 | High | `/dashboard/support` | Halaman terjebak di `"Memuat..."` selamanya jika `GET /api/v1/tickets` mengembalikan 401/403/error. | 1. Masuk ke `/dashboard/support`. 2. Server mengembalikan 401. 3. UI tidak keluar dari state `null`. | `src/SupportTickets.tsx` tidak memanggil `setTickets([])` pada `!r.ok` dan mengirim `Bearer cookie_session`. | Fixed locally (`src/SupportTickets.tsx`). |
| BUG-03 | High | `/dashboard`, `/dashboard/developers`, `/dashboard/detectors/*`, `/dashboard/mutations` | Akun `Administrator` mendapat `403 Akun merchant diperlukan.` dan topbar menampilkan badge `MERCHANT`. | 1. Login sebagai `Administrator`. 2. Buka `/dashboard` atau `/dashboard/developers`. | Network `403` pada `/api/v1/api-keys`, `/api/v1/webhook-settings`, `/api/v1/shopee-listener`, `/api/v1/shopeepay/config`; topbar badge tertulis `MERCHANT`. | Partially fixed (`src/main.tsx`: badge menampilkan `ADMIN` dan `Overview` skip call merchant-only untuk admin). |
| BUG-04 | Medium | `/dashboard/transactions` | Filter strip (`ALL`, `PENDING`, `PAID`, `EXPIRED`) overflow ke kanan layar pada viewport `390x844` dan `375x812`. | 1. Buka `/dashboard/transactions`. 2. Resize ke `390x844` atau `375x812`. | Tombol `PAID 0 · Rp 0` melebar ke `x=302..422` (`right: 422 > 390px`), terpotong di kanan (`step_34_shot_2.png`). | Fixed locally (`src/style.css`). |
| BUG-05 | Medium | `/dashboard/qris`, `/dashboard/integration-guide` | Masih menampilkan banner `"Demo lokal"` / `"mode demo lokal"` di workspace produksi. | 1. Buka `/dashboard/qris` dan `/dashboard/integration-guide`. | Teks notice `"Demo lokal."` dan `"mode demo lokal"` terlihat di UI. | Open (dilaporkan untuk pembersihan lanjutan). |
| BUG-06 | Medium | `/dashboard/mutations` | Request `GET /api/v1/shopee-portal/transactions` gagal (`status 0`). | 1. Buka `/dashboard/mutations`. | Network request gagal dengan `status 0`. | Open (memerlukan pengecekan server/CORS backend untuk akun admin vs merchant). |
| BUG-07 | Low | `/dashboard/admin` | 4 tombol refresh icon-only tidak memiliki `aria-label` dan halaman tidak memiliki `<h1>`. | 1. Buka `/dashboard/admin`. 2. Inspeksi accessibility tree. | Accessibility snapshot menunjukkan button tanpa nama di header card. | Partially fixed (`aria-label` ditambahkan di `src/AdminOperations.tsx`). |
| BUG-08 | Low | `/dashboard/admin` | Inkonsistensi data KPI (`Total User: 0`, `Total Saldo User: Rp 0`) vs topup disetujui `Rp 5.000`. | 1. Login admin. 2. Buka `/dashboard/admin`. | KPI menampilkan 0 user sementara daftar topup & saldo biaya menampilkan `Rp 5.000`. | Open (memerlukan sinkronisasi endpoint/deployment backend terbaru di VPS). |

---

## Technical Evidence
- **Console Errors**: Tidak ditemukan uncaught JavaScript exception pada seluruh rute yang dikunjungi.
- **Network Failures**:
  - `GET https://www.prefixxx.web.id/dashboard` → `404` (on reload/direct load)
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/tickets` → `401`
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/api-keys` → `403`
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/webhook-settings` → `403`
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/shopee-listener` → `403`
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/shopee-listener/events` → `403`
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/shopeepay/config` → `403`
  - `GET https://api.ditsgate.prefixxx.web.id/api/v1/shopee-portal/transactions` → `status 0`
- **Responsive Measurements**:
  - `/dashboard`: 0 horizontal overflow di `1920x1080`, `1366x768`, `768x1024`, `390x844`, `375x812`.
  - `/dashboard/transactions`: Overflow pada `.summary-strip` di `390x844` dan `375x812`.
- **Performance Measurements**: `window.performance` tidak dapat dibaca langsung karena pembatasan `page.evaluate()` di sandbox browser subagent (`NOT MEASURED`). Transisi antar rute SPA responsif (~0.5–1.5 detik).
- **Screenshots**:
  - `C:/Users/dits1/.gemini/antigravity/brain/b2561575-2cd5-4b6c-ab43-f3011d2c4c9b/browser_evidence/4b844c23-5084-4c0d-a9ba-8f8c08ecb1fd/final_step_50.png` (Host-verified latest screenshot)
  - `C:/Users/dits1/.gemini/antigravity/brain/4b844c23-5084-4c0d-a9ba-8f8c08ecb1fd/browser_sandbox/screenshots/step_30_shot_1.png` (Desktop `/dashboard`)
  - `C:/Users/dits1/.gemini/antigravity/brain/4b844c23-5084-4c0d-a9ba-8f8c08ecb1fd/browser_sandbox/screenshots/step_30_shot_2.png` (Mobile `/dashboard`)
  - `C:/Users/dits1/.gemini/antigravity/brain/4b844c23-5084-4c0d-a9ba-8f8c08ecb1fd/browser_sandbox/screenshots/step_34_shot_2.png` (Mobile `/dashboard/transactions` overflow)
  - `C:/Users/dits1/.gemini/antigravity/brain/4b844c23-5084-4c0d-a9ba-8f8c08ecb1fd/browser_sandbox/screenshots/step_46.png` (Vercel 404 on reload)

---

## Remaining Issues
1. **Deploy ke Vercel & Sync Backend VPS**: Perubahan lokal (termasuk `vercel.json`, perbaikan `SupportTickets.tsx`, `style.css`, `main.tsx`) belum di-push ke GitHub/Vercel, dan endpoint terbaru di VPS perlu disinkronkan dengan kode terbaru.
2. **Sisa Teks Demo**: `src/QrisPage.tsx` dan `src/Guide.tsx` masih mengandung teks referensi demo lokal.
3. **Performance Trace**: Pengukuran LCP/CLS/INP dan Long Tasks memerlukan Chrome DevTools MCP yang aktif pada percakapan baru setelah instalasi plugin.
