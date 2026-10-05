// Shared admission/backup contract. Backup JSON remains bounded in memory.
export const STORAGE_LIMITS = Object.freeze({
  originalBytes: 64 * 1024 * 1024,
  backupFileBytes: 64 * 1024 * 1024,
  backupBytes: 128 * 1024 * 1024,
  backupFiles: 2000,
});

// Source JSON has a separate 100k-node budget. Normalization preserves raw data
// alongside mapped fields, so cards get finite expansion headroom, not unlimited
// input growth. The 5 MiB byte ceiling remains the world-card storage contract.
export const NORMALIZED_CARD_LIMITS = Object.freeze({
  jsonBytes: 5 * 1024 * 1024,
  jsonDepth: 32,
  jsonNodes: 250000,
  stringChars: 1024 * 1024,
  arrayLength: 20000,
  nameChars: 512,
});
