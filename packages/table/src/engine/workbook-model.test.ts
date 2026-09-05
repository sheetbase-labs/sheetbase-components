import { describe, expect, it } from "vitest";
import { Workbook } from "./workbook-model";

describe("Workbook", () => {
  it("evaluates and invalidates formulas across named sheets", () => {
    const workbook = new Workbook();
    workbook.addSheet("Inputs");
    workbook.addSheet("Report");
    workbook.setInput("Inputs", "A1", "10");
    workbook.setInput("Report", "A1", "=Inputs!A1*2");
    expect(workbook.value("Report", "A1")).toBe(20);
    workbook.setInput("Inputs", "A1", "12");
    expect(workbook.value("Report", "A1")).toBe(24);
  });

  it("detects cycles across sheets", () => {
    const workbook = new Workbook();
    workbook.addSheet("One");
    workbook.addSheet("Two");
    workbook.setInput("One", "A1", "=Two!A1");
    workbook.setInput("Two", "A1", "=One!A1");
    expect(() => workbook.value("One", "A1")).toThrow("Circular reference");
  });
});

describe("Workbook defined names", () => {
  it("defines, resolves, redefines and deletes names case-insensitively", () => {
    const workbook = new Workbook();
    workbook.addSheet("Inputs");
    workbook.defineName("Sales_Q1", { sheet: "Inputs", range: "A1:A3" });
    expect(workbook.resolveName("sales_q1")).toBe("Inputs!A1:A3");
    workbook.defineName("SALES_Q1", { sheet: "Inputs", range: "B1:B2" });
    expect(workbook.resolveName("Sales_Q1")).toBe("Inputs!B1:B2");
    workbook.deleteName("sAlEs_Q1");
    expect(workbook.resolveName("Sales_Q1")).toBeUndefined();
  });

  it("rejects invalid names and A1 addresses", () => {
    const workbook = new Workbook();
    workbook.addSheet("Inputs");
    expect(() => workbook.defineName("A1", { sheet: "Inputs", range: "A1:A3" })).toThrow();
    expect(() => workbook.defineName("C10", { sheet: "Inputs", range: "A1" })).toThrow();
    expect(() => workbook.defineName("Bad Name", { sheet: "Inputs", range: "A1" })).toThrow();
  });

  it("evaluates =SUM(Sales_Q1) across sheets and invalidates through the target", () => {
    const workbook = new Workbook();
    workbook.addSheet("Inputs");
    workbook.addSheet("Report");
    workbook.setInput("Inputs", "A1", "1");
    workbook.setInput("Inputs", "A2", "2");
    workbook.setInput("Inputs", "A3", "3");
    workbook.defineName("Sales_Q1", { sheet: "Inputs", range: "A1:A3" });
    workbook.setInput("Report", "B1", "=SUM(Sales_Q1)");
    expect(workbook.value("Report", "B1")).toBe(6);
    workbook.setInput("Inputs", "A2", "20");
    expect(workbook.value("Report", "B1")).toBe(24);
  });

  it("reports #NAME? after the name is deleted and recovers on redefine", () => {
    const workbook = new Workbook();
    workbook.addSheet("Inputs");
    workbook.addSheet("Report");
    workbook.setInput("Inputs", "A1", "5");
    workbook.defineName("Rate", { sheet: "Inputs", range: "A1" });
    workbook.setInput("Report", "B1", "=Rate*2");
    expect(workbook.value("Report", "B1")).toBe(10);
    workbook.deleteName("RATE");
    expect(() => workbook.value("Report", "B1")).toThrow("#NAME?");
    workbook.defineName("rate", { sheet: "Inputs", range: "A1" });
    expect(workbook.value("Report", "B1")).toBe(10);
  });

  it("supports quoted sheet names in cross-sheet targets", () => {
    const workbook = new Workbook();
    workbook.addSheet("Raw Data");
    workbook.addSheet("Report");
    workbook.setInput("Raw Data", "A1", "4");
    workbook.setInput("Raw Data", "A2", "6");
    workbook.defineName("Raw_Total", { sheet: "Raw Data", range: "A1:A2" });
    expect(workbook.resolveName("raw_total")).toBe("'Raw Data'!A1:A2");
    workbook.setInput("Report", "B1", "=SUM(raw_total)");
    expect(workbook.value("Report", "B1")).toBe(10);
  });
});
