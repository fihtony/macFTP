import crypto from "crypto";

/**
 * 从用户密码、版本号和导出日期生成加密密钥
 * 使用 PBKDF2 算法与强盐值确保密钥安全性
 */
export function deriveKeyFromPassword(userPassword: string, version: string, exportDate: string): Buffer {
  const keyMaterial = `${userPassword}:${version}:${exportDate}`;
  const salt = Buffer.from(crypto.createHash("sha256").update("macftp-export-salt").digest("hex"), "hex");
  const key = crypto.pbkdf2Sync(keyMaterial, salt, 100000, 32, "sha256");
  return key;
}

/**
 * 加密单个字段
 */
export function encryptField(text: string, key: Buffer): string {
  if (!text) return "";
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

/**
 * 解密单个字段
 */
export function decryptField(encryptedText: string, key: Buffer): string {
  if (!encryptedText) return "";
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 2) return "";
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    return "";
  }
}

/**
 * 加密整个站点对象的敏感字段
 */
export function encryptSite(site: any, key: Buffer): any {
  return {
    ...site,
    host: site.host ? encryptField(site.host, key) : undefined,
    user: site.user ? encryptField(site.user, key) : undefined,
    password: site.password ? encryptField(site.password, key) : undefined,
    privateKeyPath: site.privateKeyPath ? encryptField(site.privateKeyPath, key) : undefined,
    privateKeyContent: site.privateKeyContent ? encryptField(site.privateKeyContent, key) : undefined,
  };
}

/**
 * 解密整个站点对象的敏感字段
 */
export function decryptSite(site: any, key: Buffer): any {
  return {
    ...site,
    host: site.host ? decryptField(site.host, key) : undefined,
    user: site.user ? decryptField(site.user, key) : undefined,
    password: site.password ? decryptField(site.password, key) : undefined,
    privateKeyPath: site.privateKeyPath ? decryptField(site.privateKeyPath, key) : undefined,
    privateKeyContent: site.privateKeyContent ? decryptField(site.privateKeyContent, key) : undefined,
  };
}
