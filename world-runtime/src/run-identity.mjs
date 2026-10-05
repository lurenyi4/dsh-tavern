import { createHash } from "node:crypto";

// UUIDv5 names in a host-generated, persisted per-run UUID namespace. The
// operation position is stable in the saved, flattened proposal. No model ID
// fields, registries or per-record counters are needed.
export function recordIdentity(namespace, operationIndex, family) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      namespace,
    ) ||
    !Number.isSafeInteger(operationIndex) ||
    operationIndex < 0 ||
    operationIndex >= 100
  )
    throw Object.assign(new Error("Invalid host operation identity"), {
      code: "INVALID_RUN_IDENTITY",
    });
  const bytes = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(family + ":" + operationIndex)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
