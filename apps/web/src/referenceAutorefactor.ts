import { toPng } from "html-to-image";
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
  const dataUrl = await toPng(canvas, {
    cacheBust: true,
    backgroundColor: "#0b1020",
    pixelRatio: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true;
      return shouldIncludeForCanvasExport(node);
    },
  });

  return {
    label: "current_view",
    mimeType: "image/png",
    dataBase64: dataUrlToBase64(dataUrl),
  };
}

export async function fileToVisionImageInput(file: File, label = "reference_view"): Promise<AiVisionImageInput> {
  const mimeType = normalizeReferenceImageMimeType(file);
  const dataUrl = await readFileAsDataUrl(file);
  return {
    label,
    mimeType,
    dataBase64: dataUrlToBase64(dataUrl),
  };
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
