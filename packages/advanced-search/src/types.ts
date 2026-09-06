export type {
  SearchSpec,
  FilterNode,
  GroupNode,
  ConditionNode,
  Combinator,
} from "sheetbase-shared";
export { emptyRoot, emptyCondition, emptyGroup } from "sheetbase-shared";
export type { FilterOperator as SearchOperator } from "sheetbase-shared";

export type SearchRow = Record<string, unknown>;
