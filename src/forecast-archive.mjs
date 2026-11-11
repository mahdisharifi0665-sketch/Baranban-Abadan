// Immutable forecast-cycle archive envelope. Raw provider payloads are retained with SHA-256.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function createForecastArchiveDocument({generatedAtUtc, target, results, failures = []}) {
  if (typeof generatedAtUtc !== "string" || !ISO_UTC.test(generatedAtUtc) || !Number.isFinite(Date.parse(generatedAtUtc))) throw new TypeError("generatedAtUtc must be an ISO UTC timestamp with milliseconds");
  if (!target || !Number.isFinite(target.latitude) || !Number.isFinite(target.longitude) || typeof target.timezone !== "string" || !Number.isInteger(target.requestedCalendarDays) || target.requestedCalendarDays < 1) throw new TypeError("Invalid forecast archive target metadata");
  if (!Array.isArray(results) || results.length === 0) throw new TypeError("Archive requires at least one successful product");
  if (!Array.isArray(failures)) throw new TypeError("failures must be an array");
  const products = results.map((item) => {
    if (!item || typeof item.model !== "string" || !["deterministic","ensemble"].includes(item.type)) throw new TypeError("Each archived product requires a model and supported type");
    if (typeof item.retrievedAtUtc !== "string" || !Number.isFinite(Date.parse(item.retrievedAtUtc))) throw new TypeError("Each product requires retrievedAtUtc");
    if (typeof item.rawPayload !== "string" || !SHA256.test(item.payloadSha256 || "")) throw new TypeError("Each product requires its raw provider payload and SHA-256 hash");
    const {rawPayload,...summary}=item;
    return {...summary,raw_payload:rawPayload};
  });
  const cycleKey = generatedAtUtc.replace(/[-:.]/g, "");
  return {archive_schema_version:"1.0.0",archive_id:"baranban-abadan-"+cycleKey,generated_at_utc:generatedAtUtc,project:{name:"Baranban Abadan",version:"5.1.0"},target,product_count:products.length,failure_count:failures.length,products,failures,archive_notes:{raw_payloads_included:true,payload_hash_algorithm:"SHA-256",model_run_time_status:"Provider endpoint did not expose an authoritative model run timestamp; do not infer it from retrieval time",forecast_skill_validated:false}};
}