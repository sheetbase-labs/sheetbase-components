/**
 * COMP-02.6 / COMP-03 / COMP-04.3 visual-fixture helper.
 *
 * Compares a rendered fixture element against a crop taken from the ELN design
 * renders (`sheetbase-eln/tests/visual/design-reference`). The crop is the
 * baseline: no Playwright snapshot store, so the number and the diff both come
 * from the checked-in design render.
 *
 * Pixel decoding happens in the page (canvas/`createImageBitmap`), so the test
 * needs no PNG codec dependency. The comparison is intentionally blunt: an
 * exact size match, then a per-channel tolerance for antialiasing, then a
 * capped ratio of differing pixels. A failure writes a diff image and reports
 * the first differing pixels so a real mismatch cannot be hidden by a loose
 * threshold.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CropCompareOptions {
  /** Allowed fraction of differing pixels. Antialiasing only — keep it small. */
  maxDiffPixelRatio?: number;
  /** Per-channel delta below which two pixels count as identical (0-255). */
  channelTolerance?: number;
  /** Where to write the diff PNG when the comparison fails. */
  diffPath?: string;
}

interface CompareResult {
  cropWidth: number;
  cropHeight: number;
  shotWidth: number;
  shotHeight: number;
  total: number;
  differing: number;
  ratio: number;
  maxDelta: number;
  /** Up to five sample mismatches as x, y, rendered rgb, crop rgb. */
  samples: string[];
  /** A data URL of the diff image (mismatched pixels in magenta). */
  diffDataUrl: string;
}

export async function compareToCrop(
  page: Page,
  locator: Locator,
  cropPath: string,
  options: CropCompareOptions = {},
): Promise<CompareResult> {
  const { maxDiffPixelRatio = 0.02, channelTolerance = 12, diffPath } = options;
  const crop = await readFile(cropPath);
  const shot = await locator.screenshot({ animations: "disabled" });

  const result = await page.evaluate(
    async ({ cropB64, shotB64, tolerance }) => {
      const decode = async (b64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        return createImageBitmap(blob);
      };
      const [cropBmp, shotBmp] = await Promise.all([decode(cropB64), decode(shotB64)]);
      const draw = (bmp: ImageBitmap) => {
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const a = draw(cropBmp);
      const b = draw(shotBmp);
      const out: {
        cropWidth: number; cropHeight: number; shotWidth: number; shotHeight: number;
        total: number; differing: number; ratio: number; maxDelta: number; samples: string[];
        diffDataUrl: string;
      } = {
        cropWidth: a.width, cropHeight: a.height, shotWidth: b.width, shotHeight: b.height,
        total: 0, differing: 0, ratio: 0, maxDelta: 0, samples: [], diffDataUrl: "",
      };
      if (a.width !== b.width || a.height !== b.height) {
        out.ratio = 1;
        return out;
      }
      const W = a.width;
      const H = a.height;
      const diff = new ImageData(W, H);
      const total = W * H;
      let differing = 0;
      let maxDelta = 0;
      for (let i = 0; i < total; i++) {
        const p = i * 4;
        const d0 = Math.abs(a.data[p] - b.data[p]);
        const d1 = Math.abs(a.data[p + 1] - b.data[p + 1]);
        const d2 = Math.abs(a.data[p + 2] - b.data[p + 2]);
        const d3 = Math.abs(a.data[p + 3] - b.data[p + 3]);
        const delta = Math.max(d0, d1, d2, d3);
        if (delta > maxDelta) maxDelta = delta;
        diff.data[p] = a.data[p];
        diff.data[p + 1] = a.data[p + 1];
        diff.data[p + 2] = a.data[p + 2];
        diff.data[p + 3] = a.data[p + 3];
        if (delta > tolerance) {
          differing++;
          if (out.samples.length < 5) {
            const x = i % W;
            const y = Math.floor(i / W);
            out.samples.push(
              `(${x},${y}) rendered rgb(${b.data[p]} ${b.data[p + 1]} ${b.data[p + 2]}) vs crop rgb(${a.data[p]} ${a.data[p + 1]} ${a.data[p + 2]})`,
            );
          }
          // Highlight mismatches in magenta against a faded crop.
          diff.data[p] = 255;
          diff.data[p + 1] = 0;
          diff.data[p + 2] = 255;
          diff.data[p + 3] = 255;
        } else {
          diff.data[p] = Math.round(a.data[p] * 0.35 + 255 * 0.65);
          diff.data[p + 1] = Math.round(a.data[p + 1] * 0.35 + 255 * 0.65);
          diff.data[p + 2] = Math.round(a.data[p + 2] * 0.35 + 255 * 0.65);
          diff.data[p + 3] = 255;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      canvas.getContext("2d")?.putImageData(diff, 0, 0);
      out.total = total;
      out.differing = differing;
      out.ratio = differing / total;
      out.maxDelta = maxDelta;
      out.diffDataUrl = canvas.toDataURL("image/png");
      return out;
    },
    { cropB64: crop.toString("base64"), shotB64: shot.toString("base64"), tolerance: channelTolerance },
  );

  const label = cropPath.split("/").pop() ?? cropPath;
  expect(result.shotWidth, `${label}: rendered width`).toBe(result.cropWidth);
  expect(result.shotHeight, `${label}: rendered height`).toBe(result.cropHeight);

  if (result.ratio > maxDiffPixelRatio) {
    if (diffPath) {
      const b64 = await page.evaluate((url) => url.slice(url.indexOf(",") + 1), result.diffDataUrl);
      await mkdir(dirname(diffPath), { recursive: true });
      await writeFile(diffPath, Buffer.from(b64, "base64"));
      await writeFile(diffPath.replace(/\.diff\.png$/, ".shot.png"), shot);
    }
    throw new Error(
      `${label}: ${result.differing}/${result.total} pixels differ ` +
        `(${(result.ratio * 100).toFixed(2)}% > ${(maxDiffPixelRatio * 100).toFixed(2)}% allowed, ` +
        `channel tolerance ${channelTolerance}, max delta ${result.maxDelta}). ` +
        `First mismatches: ${result.samples.join("; ")}${diffPath ? ` — diff at ${diffPath}` : ""}`,
    );
  }
  return result;
}
