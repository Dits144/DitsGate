# DitsGate design tokens

**IMPLEMENTATION CHOICE**, bukan ekstraksi dashboard referensi.

- Tipografi: Inter/system sans; teks dasar 13px; judul halaman 25px desktop / 22px mobile; judul section 15px.
- Warna: latar `#fafafa`, surface `#fff`, teks `#171717`, muted `#71717a`, border `#e5e7eb`, accent `#2563eb`; tema gelap memakai surface `#1a1d24` dan border `#303540`.
- Geometri: sidebar 244px, header 64px, radius kartu 8px, radius tombol 6px, border 1px, bayangan sangat ringan.
- Layout: 4 KPI desktop, 2 pada viewport <1200px; sidebar berubah drawer <900px; bottom nav <640px.
- Motion: perubahan sidebar dan tombol 160–180ms. `prefers-reduced-motion` menonaktifkan transisi panjang.
- Data: semua angka dashboard berasal dari state demo lokal; chart kosong ketika belum ada transaksi berhasil.
