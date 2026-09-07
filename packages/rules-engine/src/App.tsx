import { useState } from "react";
import { RulesEngine, parseNaturalLanguageRule } from "./index";
import type { PipelineRule } from "./index";

const starter: PipelineRule[] = [
  parseNaturalLanguageRule("when status is failed then route to review-queue"),
  parseNaturalLanguageRule("reject rows where amount is greater than 5000"),
  parseNaturalLanguageRule("if email is empty then flag for review"),
];

const fields = ["status", "amount", "region", "email"];

/** Dev demo (excluded from the published library). Page backdrop follows the card theme, table-style. */
export function App() {
  const [rules, setRules] = useState<PipelineRule[]>(starter);
  return (
    <div className="sb-demo-stage">
      <RulesEngine value={rules} onChange={setRules} fields={fields} />
    </div>
  );
}
