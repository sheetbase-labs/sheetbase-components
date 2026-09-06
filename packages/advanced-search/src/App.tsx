import { AdvancedSearch } from "./index";
import type { SearchRow } from "./index";

const fields = ["status", "amount", "region"];

const rows: SearchRow[] = [
  { status: "failed", amount: 6000, region: "eu" },
  { status: "ok", amount: 100, region: "us" },
  { status: "blocked", amount: 50, region: "eu" },
  { status: "failed", amount: 250, region: "us" },
  { status: "ok", amount: 8900, region: "eu" },
  { status: "pending", amount: 430, region: "apac" },
];

/** Dev demo (excluded from the published library). */
export function App() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 44, background: "#ececef" }}>
      <AdvancedSearch fields={fields} rows={rows} />
    </div>
  );
}
