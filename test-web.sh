#!/bin/bash
# Test script for RoccoBots Web Interface

echo "🔑 Generating encryption key..."
export ENCRYPTION_KEY=$(node generate-key.js 2>/dev/null | grep "export ENCRYPTION_KEY" | cut -d'"' -f2)

echo "✅ Encryption key generated"
echo ""

echo "Setting test environment variables..."
export WEB_ADMIN_PASSWORD="testpassword123"
export TWITTER_USERNAME="${TWITTER_USERNAME:-your_twitter_email@example.com}"
export TWITTER_PASSWORD="${TWITTER_PASSWORD:-your_twitter_password}"
export WEB_PORT=3000

echo "✅ Environment variables set"
echo ""
echo "🚀 Starting web server..."
echo "   URL: http://localhost:3000"
echo "   Password: testpassword123"
echo ""

bun src/web-index.ts
