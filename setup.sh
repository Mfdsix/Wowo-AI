#!/bin/bash
# setup.sh — Persiapan environment wowo.ai
# Jalankan: chmod +x setup.sh && ./setup.sh

set -e

echo "🚀 wowo.ai — Setup"

# Generate .env dengan absolute path biar Prisma engine bisa nemu SQLite
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cat > "$PROJECT_DIR/.env" << ENVEOF
# Database (SQLite)
DATABASE_URL="file:${PROJECT_DIR}/prisma/dev.db"

# LLM Configuration (OpenAI-compatible endpoint)
# Ganti dengan URL endpoint LLM lo (Ollama / LiteLLM / vLLM / dll)
LLM_BASE_URL="http://localhost:11434/v1"
LLM_API_KEY=""
LLM_MODEL="gpt-3.5-turbo"
ENVEOF

echo "✓ .env generated"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Setup database
echo "🗄️  Setting up database..."
npx prisma migrate dev --name init

echo ""
echo "✅ Setup selesai!"
echo ""
echo "Jalankan: npm run dev"
echo "Buka: http://localhost:3000"
