import {createHash} from "node:crypto";
// Immutable forecast-cycle archive envelope. Raw provider payloads are retained with SHA-256.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isValidUtcTimestamp(value) {
  if (typeof value !== "string" || !ISO_UTC.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  const date = new Date(ms);
  return date.toISOString() === value;
}

export function createForecastArchiveDocument({generatedAtUtc, target, results, failures = []}) {
  if (!isValidUtcTimestamp(generatedAtUtc)) throw new TypeError("generatedAtUtc must be an ISO UTC timestamp with milliseconds");
  if (!target || !Number.isFinite(target.latitude) || target.latitude < -90 || target.latitude > 90 || !Number.isFinite(target.longitude) || target.longitude < -180 || target.longitude > 180 || typeof target.timezone !== "string" || !target.timezone.trim() || !Number.isInteger(target.requestedCalendarDays) || target.requestedCalendarDays < 1) throw new TypeError("Invalid forecast archive target metadata");
  if (!Array.isArray(results) || results.length === 0) throw new TypeError("Archive requires at least one successful product");
  if (!Array.isArray(failures)) throw new TypeError("failures must be an array");
  const products = results.map((item) => {
    if (!item || typeof item.model !== "string" || !["deterministic","ensemble"].includes(item.type)) throw new TypeError("Each archived product requires a model and supported type");
    if (!isValidUtcTimestamp(item.retrievedAtUtc)) throw new TypeError("Each product requires retrievedAtUtc");
    if (typeof item.rawPayload !== "string" || !SHA256.test(item.payloadSha256 || "")) throw new TypeError("Each product requires its raw provider payload and SHA-256 hash");
    const actualHash=createHash("sha256").update(item.rawPayload).digest("hex");
    if (actualHash !== item.payloadSha256) throw new TypeError("Raw provider payload SHA-256 mismatch");
    const {rawPayload,verificationRawPayload,verificationPayloadSha256,verificationTimezone,verificationWindow,...summary}=item;
    const product={...summary,raw_payload:rawPayload};
    if(verificationRawPayload!==undefined){
      if(typeof verificationRawPayload!=="string"||!SHA256.test(verificationPayloadSha256||""))throw new TypeError("Verification payload and SHA-256 are required together");
      const verificationHash=createHash("sha256").update(verificationRawPayload).digest("hex");
      if(verificationHash!==verificationPayloadSha256)throw new TypeError("Verification payload SHA-256 mismatch");
      product.verification_raw_payload=verificationRawPayload;
      product.verification_payload_sha256=verificationHash;
      product.verification_timezone=verificationTimezone||"UTC";
      product.verification_window=verificationWindow||null;
    }
    return product;
  });
  const cycleKey = generatedAtUtc.replace(/[-:.]/g, "");
  return {archive_schema_version:"1.0.0",archive_id:"baranban-abadan-"+cycleKey,generated_at_utc:generatedAtUtc,project:{name:"BaranYar Abadan",version:"6.0.0"},target,product_count:products.length,failure_count:failures.length,products,failures,archive_notes:{raw_payloads_included:true,payload_hash_algorithm:"SHA-256",model_run_time_status:"Provider endpoint did not expose an authoritative model run timestamp; do not infer it from retrieval time",forecast_skill_validated:false}};
}