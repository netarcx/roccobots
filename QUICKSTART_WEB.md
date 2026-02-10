# Quick Start: RoccoBots Web Interface

Get the web interface up and running in 5 minutes!

## Step 1: Generate Encryption Key

```bash
bun run generate-key
```

Copy the output key that looks like:
```
export ENCRYPTION_KEY="a1b2c3d4..."
```

## Step 2: Set Environment Variables

```bash
# Paste the key from step 1
export ENCRYPTION_KEY="your_key_here"

# Set your admin password
export WEB_ADMIN_PASSWORD="your_secure_password"

# Set your Twitter credentials (for authentication)
export TWITTER_USERNAME="your_twitter_email@example.com"
export TWITTER_PASSWORD="your_twitter_password"
```

## Step 3: Start the Web Server

```bash
bun run start:web
```

You should see:
```
🚀 Server starting on http://localhost:3000
📝 Login with your WEB_ADMIN_PASSWORD
```

## Step 4: Open Your Browser

Navigate to: **http://localhost:3000**

Login with the password you set in `WEB_ADMIN_PASSWORD`

## Step 5: Add Your First Bot

### Option A: Import from Existing .env

If you already have a `.env` file with bot configurations:

1. Click the **"Import from .env"** button on the dashboard
2. Your bots will be automatically imported
3. Click **"Start All"** to begin syncing

### Option B: Create Manually

1. Click **"Add New Bot"**
2. Fill in the form:
   - **Twitter Handle**: The account you want to sync (e.g., `elonmusk`)
   - **Twitter Username**: Your Twitter login email
   - **Twitter Password**: Your Twitter password
   - **Sync Frequency**: How often to sync (in minutes)
3. Click **"Create Bot"**
4. Add platforms (Bluesky, Mastodon, etc.) by editing the bot
5. Click **"Start"** to begin syncing

## Step 6: Add Platform Credentials

After creating a bot, you need to add at least one platform:

### Bluesky
1. Go to bot details
2. Click "Add Platform"
3. Select "Bluesky"
4. Enter:
   - `BLUESKY_IDENTIFIER`: Your Bluesky handle (e.g., `example.bsky.social`)
   - `BLUESKY_PASSWORD`: Your Bluesky password or app password

### Mastodon
1. Select "Mastodon"
2. Enter:
   - `MASTODON_INSTANCE`: Your instance URL (e.g., `mastodon.social`)
   - `MASTODON_TOKEN`: Your access token

### Misskey
1. Select "Misskey"
2. Enter:
   - `MISSKEY_INSTANCE`: Your instance URL (e.g., `misskey.io`)
   - `MISSKEY_TOKEN`: Your access token

### Discord Webhook
1. Select "Discord"
2. Enter:
   - `DISCORD_WEBHOOK`: Your webhook URL

## Troubleshooting

### "ENCRYPTION_KEY environment variable is required"
Run `bun run generate-key` and set the output as an environment variable.

### "WEB_ADMIN_PASSWORD environment variable not set"
Set it with: `export WEB_ADMIN_PASSWORD="your_password"`

### Can't login to Twitter
Make sure `TWITTER_USERNAME` and `TWITTER_PASSWORD` are correct. These are YOUR credentials to login to Twitter, not the account you're syncing.

### Bot starts but doesn't sync
Check that:
1. The Twitter handle is correct
2. At least one platform is configured and enabled
3. Platform credentials are valid

## Next Steps

- View real-time logs in the dashboard
- Add multiple bots
- Configure sync frequency per bot
- Enable/disable specific sync features (posts, profile, etc.)

## Need Help?

See the full documentation: [WEB_INTERFACE.md](./WEB_INTERFACE.md)

## Going Back to CLI Mode

To use the original CLI mode:

```bash
# Make sure WEB_MODE is not set
unset WEB_MODE

# Run the original CLI
bun run start
```

Your `.env` file configurations will still work!
