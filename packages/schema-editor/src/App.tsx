import { useState } from "react";
import { SchemaEditor } from "./index";
import type { SchemaGraph } from "./index";

const starter: SchemaGraph = {
  models: [
    {
      name: "customer", label: "Customer",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "name", type: "text" },
        { key: "email", type: "text" },
        { key: "created_at", type: "date" },
      ],
    },
    {
      name: "order", label: "Order",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "customer_id", type: "relationship", references: { model: "customer" } },
        { key: "total", type: "number" },
        { key: "status", type: "text" },
      ],
    },
    {
      name: "product", label: "Product",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "name", type: "text" },
        { key: "price", type: "number" },
      ],
    },
    {
      name: "line_item", label: "Line item",
      fields: [
        { key: "id", type: "text", primaryKey: true },
        { key: "order_id", type: "relationship", references: { model: "order" } },
        { key: "product_id", type: "relationship", references: { model: "product" } },
        { key: "qty", type: "number" },
      ],
    },
  ],
};

/** Dev demo (excluded from the published library). */
export function App() {
  const [graph, setGraph] = useState<SchemaGraph>(starter);
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 44, background: "#ececef" }}>
      <SchemaEditor value={graph} onChange={setGraph} />
    </div>
  );
}
