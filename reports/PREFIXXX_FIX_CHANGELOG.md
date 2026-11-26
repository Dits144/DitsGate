# PREFIXXX Fix Changelog

**Tanggal:** 2026-11-26

## Ringkasan Perubahan Lokal

### 1. `vercel.json` (Baru)
- **Root Cause:** Direct load atau refresh (`F5`) pada rute subpath SPA (`/dashboard`, `/login`, dll.) di Vercel menghasilkan HTTP `404: NOT_FOUND`.
- **Perubahan:** Menambahkan rewrite rule `/(.*) -> /index.html` untuk SPA fallback.

### 2. `src/SupportTickets.tsx`
- **Root Cause:** `TicketList.load()` tidak mengubah state `tickets` dari `null` jika response API bukan `2xx` (mis. `401`), dan mengirim header `Authorization: Bearer cookie_session` tanpa `credentials: 'include'`.
- **Perubahan:** Menambahkan `credentials: 'include'`, melewati header Bearer jika token bernilai `'cookie_session'`, serta menangani response error dengan menampilkan pesan error (`role="alert"`) dan `setTickets([])` agar tidak terjebak di `"Memuat..."`.

### 3. `src/main.tsx`
- **Root Cause:**
  1. Badge peran di topbar selalu menampilkan `'MERCHANT'` meskipun user yang login berstatus `admin`.
  2. `Overview.refresh()` tetap memanggil endpoint khusus merchant (`/api/v1/api-keys`, `/api/v1/webhook-settings`, `/api/v1/shopee-listener`, `/api/v1/shopee-portal`) saat login sebagai `admin`, memicu HTTP `403`.
- **Perubahan:**
  1. Mengubah badge topbar menjadi `{merchant.user.role==='admin'?'ADMIN':'MERCHANT'}`.
  2. Melewati panggilan endpoint merchant-only di `Overview.refresh()` ketika `merchant.user.role === 'admin'`.

### 4. `src/style.css`
- **Root Cause:** `.summary-strip` pada `/dashboard/transactions` menyebabkan tombol status filter (`PAID 0 · Rp 0`) melampaui lebar viewport mobile (`390x844` dan `375x812`).
- **Perubahan:** Menambahkan aturan `flex-wrap: wrap` dan grid 2 kolom (`repeat(2, minmax(0, 1fr))`) pada `@media(max-width:640px)`.

### 5. `src/AdminOperations.tsx`
- **Root Cause:** Tombol refresh icon-only pada `TicketAdmin` tidak memiliki `aria-label` untuk aksesibilitas.
- **Perubahan:** Menambahkan `aria-label="Segarkan tiket pengaduan"`.

## Hasil Verifikasi Lokal
- `npm.cmd run typecheck` dan `npm.cmd run build`: Dijalankan setelah semua edit terakhir (lihat output build).
- **Catatan:** Belum dilakukan push/deploy ke produksi sesuai aturan audit.
