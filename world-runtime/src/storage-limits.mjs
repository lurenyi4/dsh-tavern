// Shared admission/backup contract. Backup JSON remains bounded in memory.
export const STORAGE_LIMITS = Object.freeze({
  originalBytes: 64 * 1024 * 1024,
  backupFileBytes: 64 * 1024 * 1024,
  backupBytes: 128 * 1024 * 1024,
  backupFiles: 2000,
});
