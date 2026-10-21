import { environmentBannerModel, readNestoryEnvironment } from "@/lib/env/nestoryEnv";

// STAGING 1.6: shown only outside production, or when the environment settings
// disagree. Server component -- reads process.env at request time.
export function EnvironmentBanner() {
  const m = environmentBannerModel(readNestoryEnvironment());
  if (!m) return null;
  return (
    <div className={`env-banner env-banner--${m.tone}`} role={m.tone === "danger" ? "alert" : "status"}>
      {m.text}
    </div>
  );
}
