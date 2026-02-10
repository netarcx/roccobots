#!/usr/bin/env node
/**
 * Generate a secure encryption key for RoccoBots Web Interface
 */

import crypto from 'crypto';

const key = crypto.randomBytes(32).toString('hex');

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║  🔑 RoccoBots Web Interface - Encryption Key Generator  ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

console.log('Your encryption key has been generated!\n');
console.log('Add this to your environment:\n');
console.log(`  export ENCRYPTION_KEY="${key}"`);
console.log('\nOr add it to your .env file:\n');
console.log(`  ENCRYPTION_KEY=${key}`);
console.log('\n⚠️  Keep this key secure and never commit it to version control!');
console.log('💡 You\'ll also need to set WEB_ADMIN_PASSWORD for the web interface.\n');
