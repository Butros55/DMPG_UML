import { useEffect, useState } from "react";
import type { UmlReferenceAutorefactorOptions } from "@dmpg/shared";
import {
  DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION,
  DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS,
} from "../referenceAutorefactor";

interface ReferenceAutorefactorDialogProps {
  open: boolean;
  viewTitle: string;
  running: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (payload: {
    referenceFile: File;
    instruction: string;
    options: UmlReferenceAutorefactorOptions;
  }) => Promise<void> | void;
}

export function ReferenceAutorefactorDialog({
  open,
  viewTitle,
  running,
  error,
  onClose,
  onSubmit,
}: ReferenceAutorefactorDialogProps) {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [instruction, setInstruction] = useState(DEFAULT_REFERENCE_AUTOREFACTOR_INSTRUCTION);
  const [options, setOptions] = useState<UmlReferenceAutorefactorOptions>(DEFAULT_REFERENCE_AUTOREFACTOR_OPTIONS);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLocalError("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="reference-autorefactor-dialog-overlay" onClick={running ? undefined : onClose}>
      <div className="reference-autorefactor-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="reference-autorefactor-dialog__header">
          <div>
            <h3>Mit Referenz anpassen</h3>
            <p>Aktueller View: {viewTitle}</p>
          </div>
          <button
            className="reference-autorefactor-dialog__close"
            onClick={onClose}
            disabled={running}
            aria-label="Dialog schließen"
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="reference-autorefactor-dialog__body">
          <label className="reference-autorefactor-field">
            <span className="reference-autorefactor-field__label">Referenzbild</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp"
              onChange={(event) => {
                setReferenceFile(event.target.files?.[0] ?? null);
                setLocalError("");
              }}
              disabled={running}
            />
            <span className="reference-autorefactor-field__hint">
              Lade genau ein Professor-, Draw.io- oder Referenzbild hoch. Der aktuelle View wird automatisch als IST-Bild exportiert.
            </span>
            {referenceFile && (
              <span className="reference-autorefactor-field__file">
                <i className="bi bi-image" /> {referenceFile.name}
              </span>
            )}
          </label>

          <label className="reference-autorefactor-field">
            <span className="reference-autorefactor-field__label">Instruktion</span>
            <textarea
              className="reference-autorefactor-field__textarea"
              rows={8}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={running}
            />
          </label>

          <div className="reference-autorefactor-options">
            <label className="reference-autorefactor-option">
              <input
                type="checkbox"
                checked={options.autoApply ?? false}
                onChange={(event) => setOptions((current) => ({ ...current, autoApply: event.target.checked }))}
                disabled={running}
              />
              Änderungen automatisch anwenden
            </label>
            <label className="reference-autorefactor-option">
              <input
                type="checkbox"
                checked={options.allowStructuralChanges ?? false}
                onChange={(event) => setOptions((current) => ({ ...current, allowStructuralChanges: event.target.checked }))}
                disabled={running}
              />
              Struktur- und Layer-Änderungen erlauben
            </label>
            <label className="reference-autorefactor-option">
              <input
                type="checkbox"
                checked={options.allowLabelChanges ?? false}
                onChange={(event) => setOptions((current) => ({ ...current, allowLabelChanges: event.target.checked }))}
                disabled={running}
              />
              Label-Änderungen erlauben
            </label>
            <label className="reference-autorefactor-option">
              <input
                type="checkbox"
                checked={options.allowRelationChanges ?? false}
                onChange={(event) => setOptions((current) => ({ ...current, allowRelationChanges: event.target.checked }))}
                disabled={running}
              />
              Relations- und Kontext-Anpassungen erlauben
            </label>
            <label className="reference-autorefactor-option">
              <input
                type="checkbox"
                checked={options.persistSuggestions ?? false}
                onChange={(event) => setOptions((current) => ({ ...current, persistSuggestions: event.target.checked }))}
                disabled={running}
              />
              Ergebnisse als ReviewHints speichern
            </label>
          </div>

          {(localError || error) && (
            <div className="reference-autorefactor-dialog__error">
              {localError || error}
            </div>
          )}
        </div>

        <div className="reference-autorefactor-dialog__footer">
          <button className="btn btn-sm btn-outline" onClick={onClose} disabled={running}>
            Abbrechen
          </button>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (!referenceFile) {
                setLocalError("Bitte lade zuerst genau ein Referenzbild hoch.");
                return;
              }
              setLocalError("");
              await onSubmit({
                referenceFile,
                instruction,
                options,
              });
            }}
            disabled={running}
          >
            <i className="bi bi-magic" /> {running ? "Vergleiche und passe an…" : "Mit Referenz anpassen"}
          </button>
        </div>
      </div>
    </div>
  );
}
