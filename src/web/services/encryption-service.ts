import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { DATABASE_PATH } from "env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

let _cachedKey: Buffer | null = null;

/**
 * Get encryption key with 3-tier fallback:
 * 1. ENCRYPTION_KEY env var (backwards compatible)
 * 2. .encryption.key file next to the database
 * 3. Generate a new key and persist it
 */
function getEncryptionKey(): Buffer {
    if (_cachedKey) return _cachedKey;

    // Tier 1: env var
    const envKey = process.env.ENCRYPTION_KEY;
    if (envKey) {
        const keyBuffer = Buffer.from(envKey, "hex");
        if (keyBuffer.length !== 32) {
            throw new Error(
                "ENCRYPTION_KEY must be 32 bytes (64 hex characters)",
            );
        }
        _cachedKey = keyBuffer;
        return keyBuffer;
    }

    // Tier 2 & 3: file-based key
    const keyFilePath = join(dirname(DATABASE_PATH), ".encryption.key");

    if (existsSync(keyFilePath)) {
        const hex = readFileSync(keyFilePath, "utf-8").trim();
        const keyBuffer = Buffer.from(hex, "hex");
        if (keyBuffer.length !== 32) {
            throw new Error(
                `.encryption.key file is invalid (expected 64 hex characters)`,
            );
        }
        _cachedKey = keyBuffer;
        return keyBuffer;
    }

    // Tier 3: generate and persist
    const newKey = randomBytes(32);
    writeFileSync(keyFilePath, newKey.toString("hex") + "\n", {
        mode: 0o600,
    });
    console.log(`Generated encryption key → ${keyFilePath}`);
    _cachedKey = newKey;
    return newKey;
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns: iv:authTag:encryptedData (all hex encoded)
 */
export function encrypt(text: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt()
 */
export function decrypt(encryptedText: string): string {
    const key = getEncryptionKey();
    const parts = encryptedText.split(":");

    if (parts.length !== 3) {
        throw new Error("Invalid encrypted text format");
    }

    const [ivHex, authTagHex, encryptedData] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
}

/**
 * Encrypt a JSON object
 */
export function encryptJSON(obj: unknown): string {
    return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt a JSON object
 */
export function decryptJSON<T = unknown>(encryptedText: string): T {
    const decrypted = decrypt(encryptedText);
    return JSON.parse(decrypted) as T;
}
