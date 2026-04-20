import { useAppStore } from "../store";
import { formatViewTitle } from "../viewTitles";

export function Breadcrumb() {
  const breadcrumb = useAppStore((s) => s.breadcrumb);
  const graph = useAppStore((s) => s.graph);
  const navigateToView = useAppStore((s) => s.navigateToView);
  const projectionMode = useAppStore((s) => s.projectionMode);
  const sequenceContext = useAppStore((s) => s.sequenceContext);
  const closeSequenceContext = useAppStore((s) => s.closeSequenceContext);

  if (!graph || breadcrumb.length === 0) return null;

  const sequenceCrumbActive =
    projectionMode === "sequence" &&
    !!sequenceContext &&
    breadcrumb[breadcrumb.length - 1] === sequenceContext.originViewId;
  const items = sequenceCrumbActive ? [...breadcrumb, "__sequence__"] : breadcrumb;

  return (
    <div className="breadcrumb">
      {items.map((viewId, i) => {
        const isSequenceCrumb = viewId === "__sequence__";
        const view = isSequenceCrumb ? null : graph.views.find((v) => v.id === viewId);
        const isLast = i === items.length - 1;
        const label = isSequenceCrumb
          ? sequenceContext?.title ?? "Sequenzdiagramm"
          : formatViewTitle(view?.title, viewId);
        return (
          <span key={viewId}>
            {i > 0 && <span className="sep">›</span>}
            {isLast ? (
              <span style={{ color: "var(--text)" }}>{label}</span>
            ) : (
              <button
                onClick={() => {
                  if (sequenceCrumbActive && i === items.length - 2) {
                    closeSequenceContext();
                    return;
                  }
                  navigateToView(viewId, { restoreViewState: true });
                }}
              >
                {label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
