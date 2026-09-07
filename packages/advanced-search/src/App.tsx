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

/** Dev demo (excluded from the published library). Page backdrop follows the card theme, table-style. */
export function App() {
  return (
    <div className="sb-demo-stage">
      <AdvancedSearch fields={fields} rows={rows} />
    </div>
  );
}
