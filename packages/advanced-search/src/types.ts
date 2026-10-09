export type {
  SearchSpec,
  FilterNode,
  GroupNode,
  ConditionNode,
  Combinator,
} from "@sheetbase-labs/sheetbase-shared";
export { emptyRoot, emptyCondition, emptyGroup } from "@sheetbase-labs/sheetbase-shared";
export type { FilterOperator as SearchOperator } from "@sheetbase-labs/sheetbase-shared";

export type SearchRow = Record<string, unknown>;
