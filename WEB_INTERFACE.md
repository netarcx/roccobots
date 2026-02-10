# RoccoBots Web Interface

A web-based dashboard for managing Twitter to Bluesky/Mastodon/Misskey/Discord bots.

## Features

- **Web Dashboard**: Manage multiple bots from a browser interface
- **Real-time Logs**: Live streaming of sync logs via Server-Sent Events
- **Bot Management**: Start/stop individual bots or all bots at once
- **Platform Configuration**: Add/remove/configure platforms for each bot
- **Secure**: Encrypted credential storage with AES-256-GCM
- **Import Tool**: Migrate existing .env configurations to the database
- **Backward Compatible**: CLI mode still works for existing users

## Quick Start

### 1. Generate Encryption Key

```bash
openssl rand -hex 32
```

### 2. Set Environment Variables

```bash
export WEB_ADMIN_PASSWORD="your_secure_password_here"
export ENCRYPTION_KEY="<key_from_step_1>"
export WEB_PORT=3000  # optional, defaults to 3000
```

### 3. Start Web Server

```bash
bun src/web-index.ts
```

Or with all variables in one line:

```bash
WEB_ADMIN_PASSWORD="mypassword" ENCRYPTION_KEY="abc123..." bun src/web-index.ts
```

### 4. Access Dashboard

Open your browser to: http://localhost:3000

Login with your `WEB_ADMIN_PASSWORD`

## Importing Existing Configuration

If you already have a `.env` file with bot configurations:

1. Start the web server
2. Login to the dashboard
3. Click "Import from .env" button
4. Your existing bots and platforms will be imported to the database

## Dual-Mode Operation

### CLI Mode (Original)

Run without `WEB_MODE` environment variable:

```bash
bun src/index.ts
```

This will run the traditional daemon mode, reading from `.env` file.

### Web Mode (New)

Run the web server:

```bash
bun src/web-index.ts
```

This starts the web interface on port 3000 (or `WEB_PORT`).

## Architecture

### Database Schema

The web interface adds new tables to the SQLite database:

- **bot_configs**: Bot Twitter credentials and sync settings
- **platform_configs**: Platform-specific credentials (Bluesky, Mastodon, etc.)
- **sync_logs**: Historical sync logs
- **bot_status**: Current runtime status of each bot
- **web_sessions**: Web session storage

### API Endpoints

#### Authentication
- `POST /api/auth/login` - Login with admin password
- `POST /api/auth/logout` - Logout
- `GET /api/auth/status` - Check auth status

#### Bot Management
- `GET /api/bots` - List all bots
- `GET /api/bots/:id` - Get bot details
- `POST /api/bots` - Create new bot
- `PUT /api/bots/:id` - Update bot
- `DELETE /api/bots/:id` - Delete bot
- `POST /api/bots/:id/start` - Start bot
- `POST /api/bots/:id/stop` - Stop bot
- `POST /api/bots/start-all` - Start all enabled bots
- `POST /api/bots/stop-all` - Stop all bots
- `GET /api/bots/:id/logs` - Get bot logs

#### Platform Management
- `GET /api/bots/:botId/platforms` - List platforms
- `POST /api/bots/:botId/platforms` - Add platform
- `PUT /api/bots/:botId/platforms/:platformId` - Update platform
- `DELETE /api/bots/:botId/platforms/:platformId` - Remove platform

#### System
- `GET /api/system/status` - System overview
- `GET /api/events` - SSE endpoint for real-time updates
- `POST /api/config/import-env` - Import from .env file

### Security

1. **Credential Encryption**: All passwords and tokens are encrypted with AES-256-GCM
2. **Session Security**: HTTP-only cookies with secure flags in production
3. **Password Authentication**: Simple admin password for dashboard access
4. **Environment Variables**: Sensitive keys stored in environment, not code

### Environment Variables

#### Required for Web Mode

- `WEB_ADMIN_PASSWORD` - Admin password for web dashboard (min 12 chars recommended)
- `ENCRYPTION_KEY` - 32-byte hex string for encrypting credentials

#### Optional

- `WEB_PORT` - Port for web server (default: 3000)
- `DATABASE_PATH` - SQLite database path (default: data.sqlite)

#### Still Required (for Twitter client)

- `TWITTER_USERNAME` - Your Twitter login email/username
- `TWITTER_PASSWORD` - Your Twitter password

## Bot Configuration

### Creating a Bot via Web Interface

1. Navigate to dashboard
2. Click "Add New Bot"
3. Fill in:
   - Twitter handle (the account to sync FROM)
   - Twitter username (for login, can be reused across bots)
   - Twitter password (for login, can be reused across bots)
   - Sync frequency in minutes
   - Sync options (posts, profile, etc.)
4. Click "Create Bot"
5. Add platforms (Bluesky, Mastodon, etc.)

### Adding Platforms

After creating a bot:

1. Go to bot details page
2. Click "Add Platform"
3. Select platform type
4. Enter credentials:
   - **Bluesky**: BLUESKY_IDENTIFIER, BLUESKY_PASSWORD
   - **Mastodon**: MASTODON_INSTANCE, MASTODON_TOKEN
   - **Misskey**: MISSKEY_INSTANCE, MISSKEY_TOKEN
   - **Discord**: DISCORD_WEBHOOK

### Starting Bots

Bots can be started:
- Individually from bot card
- All at once with "Start All" button
- Automatically on server startup (if enabled)

## Development

### Project Structure

```
src/
├── web/
│   ├── server.ts                 # Main Hono server
│   ├── middleware/
│   │   ├── auth.ts              # Authentication
│   │   └── error.ts             # Error handling
│   ├── routes/
│   │   └── api/
│   │       ├── auth.ts          # Auth endpoints
│   │       ├── bots.ts          # Bot endpoints
│   │       ├── platforms.ts     # Platform endpoints
│   │       ├── system.ts        # System endpoints
│   │       └── events.ts        # SSE endpoint
│   └── services/
│       ├── bot-manager.ts       # Bot lifecycle manager
│       ├── config-service.ts    # Config CRUD
│       ├── encryption-service.ts # Credential encryption
│       └── config-migration.ts  # .env import tool
├── sync/
│   └── bot-instance.ts          # Single bot abstraction
├── db/
│   └── schema/
│       └── v2.ts                # New database schema
├── web-index.ts                 # Web mode entry point
└── index.ts                     # CLI mode entry point
```

### Testing

```bash
# Start web server in dev mode
bun src/web-index.ts

# Run CLI mode
bun src/index.ts
```

## Troubleshooting

### "ENCRYPTION_KEY environment variable is required"

Generate a key:
```bash
openssl rand -hex 32
```

Then export it:
```bash
export ENCRYPTION_KEY="<your_generated_key>"
```

### "WEB_ADMIN_PASSWORD environment variable not set"

Set a secure password:
```bash
export WEB_ADMIN_PASSWORD="your_secure_password"
```

### Database migration fails

Delete the database and restart (WARNING: loses all data):
```bash
rm data.sqlite
bun src/web-index.ts
```

### Bot fails to start

Check the logs in the dashboard or API response. Common issues:
- Invalid Twitter credentials
- Invalid platform credentials
- Platform API changes

## Future Enhancements

Potential future features:
- User management (multiple admin users)
- Bot scheduling (start/stop at specific times)
- Advanced log filtering and search
- Statistics and analytics dashboard
- Email/webhook notifications for errors
- Dark/light theme toggle
- Mobile-responsive design improvements

## License

Same as RoccoBots main project (AGPL-3.0-or-later)
