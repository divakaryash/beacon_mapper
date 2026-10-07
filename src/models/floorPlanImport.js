export const isPdf = file => file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

export function rasterSize(width, height) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Invalid floor-plan dimensions");
  // ponytail: one bounded raster per PDF page; tiled rendering if deeper zoom is needed.
  const scale = Math.min(2, 4096 / Math.max(width, height));
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
}

export async function readFloorPlan(file) {
  if (isPdf(file)) {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    GlobalWorkerOptions.workerSrc = workerSrc;
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const original = page.getViewport({ scale: 1 });
      const size = rasterSize(original.width, original.height);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: page.getViewport({ scale: size.scale }), background: "white" }).promise;
      const preview = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not render PDF page")), "image/png"));
      return { file, floorPlanPreview: preview, pdfPageCount: pdf.numPages, drawingWidthPixels: size.width, drawingHeightPixels: size.height };
    } finally { await task.destroy(); }
  }
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|svg)$/i.test(file.name)) throw new Error("Choose a PNG, JPG, SVG, or PDF floor plan");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Could not read floor-plan image")); image.src = source; });
    return { file, floorPlanPreview: null, pdfPageCount: null, drawingWidthPixels: image.naturalWidth, drawingHeightPixels: image.naturalHeight };
  } finally { URL.revokeObjectURL(source); }
}
