# wowo.ai

AI-powered chat & designer platform untuk bikin landing page dan web design secara instan.

## Fitur Utama

### Chat Interface
- AI chat dengan conversation history sidebar
- Quote & reply pesan sebelumnya untuk konteks yang lebih baik
- Bookmark pesan penting untuk referensi nanti
- Text selection toolbar untuk quick copy & quote

### Code Blocks
- Syntax highlighting untuk HTML, CSS, JavaScript, dan lainnya
- Fullscreen mode untuk melihat kode lebih jelas
- One-click copy ke clipboard
- Live preview langsung dari code block

### Designer Mode
- Visual design canvas dengan multiple artboards
- Generate halaman dari deskripsi teks
- Ganti style instant (Default, natural-tone, dll)
- Zoom controls untuk detail yang lebih baik
- Mobile/Web toggle untuk preview responsive

### Wireframe Preview
- Preview hasil design dalam iframe sandboxed
- Export HTML untuk kebutuhan production
- Responsive preview (mobile & desktop)

## Tech Stack

- **Framework**: Next.js 16
- **UI**: Tailwind CSS 4
- **AI**: Vercel AI SDK
- **Database**: Prisma + PostgreSQL
- **Language**: TypeScript

## NeedMCP Integration

**NeedMCP** ([https://needmcp.com](https://needmcp.com)) adalah MCP server design system yang dipakai buat fitur **"Ganti Style"** di Designer Mode. Perannya: nyediain design system (warna, typography, spacing, rounded, komponen, layout, wireframe) untuk style tertentu — AI pakai itu sebagai *grounding* biar hasil generate halaman konsisten sama design language yang dipilih user.

Integrasinya **opsional**. Tanpa API key, semua behavior jalan normal dengan style bawaan wowo.ai. Kalo aktif, flow-nya: user pilih style → style di-lock ke session → AI pre-fetch design tokens style tsb → HTML yang dihasilkan grounded ke design system-nya.

### Cara dapetin API key

1. Register/login di [https://needmcp.com](https://needmcp.com)
2. Ambil API key dari NeedMCP Dashboard
3. Set di file `.env`:

```
NEEDMCP_API_KEY="your-api-key"
```

Kosongin atau hapus variabel ini kalau mau matiin integrasinya. Contoh lengkap ada di `.env.example`.

## Getting Started

```bash
# Install dependencies
npm install

# Setup database
npx prisma db push

# Run development server
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser.

## Screenshots

| Chat Interface | Designer Mode |
|----------------|---------------|
| ![Chat](screenshots/preview.png) | ![Designer](screenshots/designer.png) |

| Code Blocks | Wireframe Preview |
|-------------|-------------------|
| ![Code](screenshots/code-block.png) | ![Preview](screenshots/preview.png) |

## License

Private - All rights reserved.
