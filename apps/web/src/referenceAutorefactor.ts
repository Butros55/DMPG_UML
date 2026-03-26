import { toJpeg } from "html-to-image";
import type {
  AiVisionImageInput,
  UmlReferenceAutorefactorOptions,
  UmlReferenceAutorefactorRequest,
} from "@dmpg/shared";

const SUPPORTED_REFERENCE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

export const DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION = `Vergleiche meinen aktuellen React-Flow-UML-View mit dem Referenzbild und passe das UML automatisch so weit wie sinnvoll an. Pruefe besonders:
1. ob mein Diagramm zu UI-artig statt UML-artig wirkt,
2. ob Packages, Datenbank-Zylinder, Artifacts, Components oder Notes fehlen,
3. ob das Layering / die View-Hierarchie verbessert werden sollte,
4. ob sichtbare Relationen oder externe Kontextknoten fehlen,
5. welche Aenderungen automatisch angewendet werden koennen,
6. welche Aenderungen nur als Review-Hinweis verbleiben sollten.`;

export const DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS: Required<UmlReferenceAutorefactorOptions> = {
  autoApply: true,
  allowStructuralChanges: true,
  allowLabelChanges: true,
  allowRelationChanges: true,
  persistSuggestions: true,
  dryRun: false,
};

const MAX_VISION_IMAGE_DIMENSION = 1800;
const TARGET_VISION_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CANVAS_EXPORT_PIXEL_RATIO = 1;

function inferMimeTypeFromFileName(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return null;
}

export function normalizeReferenceImageMimeType(file: Pick<File, "type" | "name">): string {
  const mimeType = (file.type?.trim().toLowerCase() || inferMimeTypeFromFileName(file.name) || "").trim();
  if (!SUPPORTED_REFERENCE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Reference image must be PNG, JPEG, WEBP, GIF or BMP.");
  }
  return mimeType;
}

export function dataUrlToBase64(dataUrl: string): string {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  if (!match) {
    throw new Error("Expected a base64 data URL for the exported view image.");
  }
  return match[1]!.replace(/\s+/g, "");
}

export function estimateBase64Bytes(dataBase64: string): number {
  const normalized = dataBase64.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read reference image "${file.name}".`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not decode reference image "${file.name}".`));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the selected reference image."));
    image.src = dataUrl;
  });
}

async function optimizeVisionImage(params: {
  label: string;
  dataUrl: string;
  sourceMimeType: string;
  targetMimeType?: "image/jpeg" | "image/png" | "image/webp";
  maxDimension?: number;
  targetBytes?: number;
}): Promise<AiVisionImageInput> {
  const sourceBase64 = dataUrlToBase64(params.dataUrl);
  const sourceBytes = estimateBase64Bytes(sourceBase64);
  const maxDimension = params.maxDimension ?? MAX_VISION_IMAGE_DIMENSION;
  const targetBytes = params.targetBytes ?? TARGET_VISION_IMAGE_BYTES;
  const preferredMimeType = params.targetMimeType ?? "image/jpeg";

  if (sourceBytes <= targetBytes && sourceMimeTypeIsCompact(params.sourceMimeType) && sourceBytes > 0) {
    return {
      label: params.label,
      mimeType: params.sourceMimeType,
      dataBase64: sourceBase64,
    };
  }

  const image = await loadImage(params.dataUrl);
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      label: params.label,
      mimeType: params.sourceMimeType,
      dataBase64: sourceBase64,
    };
  }

  if (preferredMimeType === "image/jpeg") {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const qualities = preferredMimeType === "image/jpeg" ? [0.88, 0.8, 0.72, 0.64] : [undefined];
  for (const quality of qualities) {
    const optimizedUrl = canvas.toDataURL(preferredMimeType, quality);
    const optimizedBase64 = dataUrlToBase64(optimizedUrl);
    if (estimateBase64Bytes(optimizedBase64) <= targetBytes || quality === qualities[qualities.length - 1]) {
      return {
        label: params.label,
        mimeType: preferredMimeType,
        dataBase64: optimizedBase64,
      };
    }
  }

  return {
    label: params.label,
    mimeType: params.sourceMimeType,
    dataBase64: sourceBase64,
  };
}

function sourceMimeTypeIsCompact(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/webp";
}

function getCanvasExportElement(): HTMLElement {
  const element = document.querySelector(".canvas-area .react-flow") as HTMLElement | null;
  if (!element) {
    throw new Error("Could not find the active React Flow canvas to export the current view.");
  }
  return element;
}

function shouldIncludeForCanvasExport(node: HTMLElement): boolean {
  return !(
    node.classList.contains("react-flow__controls")
    || node.classList.contains("react-flow__minimap")
    || node.classList.contains("ai-canvas-overlay")
    || node.classList.contains("connect-type-dialog-overlay")
    || node.classList.contains("edge-label-editor")
  );
}

export async function captureCurrentViewAsVisionImage(): Promise<AiVisionImageInput> {
  const canvas = getCanvasExportElement();
  const dataUrl = await toJpeg(canvas, {
    cacheBust: true,
    backgroundColor: "#0b1020",
    pixelRatio: MAX_CANVAS_EXPORT_PIXEL_RATIO,
    quality: 0.86,
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true;
      return shouldIncludeForCanvasExport(node);
    },
  });
  return optimizeVisionImage({
    label: "current_view",
    dataUrl,
    sourceMimeType: "image/jpeg",
    targetMimeType: "image/jpeg",
  });
}

export async function fileToVisionImageInput(file: File, label = "reference_view"): Promise<AiVisionImageInput> {
  const mimeType = normalizeReferenceImageMimeType(file);
  const dataUrl = await readFileAsDataUrl(file);
  return optimizeVisionImage({
    label,
    dataUrl,
    sourceMimeType: mimeType,
    targetMimeType: mimeType === "image/png" ? "image/jpeg" : mimeType === "image/jpeg" || mimeType === "image/webp" ? mimeType : "image/jpeg",
  });
}

export function buildReferenceAutorefactorRequest(params: {
  currentViewImage: AiVisionImageInput;
  referenceImage: AiVisionImageInput;
  viewId: string;
  instruction?: string;
  graphContext?: unknown;
  options?: UmlReferenceAutorefactorOptions;
}): UmlReferenceAutorefactorRequest {
  return {
    currentViewImage: params.currentViewImage,
    referenceImage: params.referenceImage,
    viewId: params.viewId,
    instruction: params.instruction?.trim() || DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION,
    graphContext: params.graphContext,
    options: {
      ...DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS,
      ...(params.options ?? {}),
    },
  };
}
