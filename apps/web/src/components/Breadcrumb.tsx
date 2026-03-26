import { useAppStore } from "../store";
import { formatViewTitle } from "../viewTitles";

export function Breadcrumb() {
  const breadcrumb = useAppStore((s) => s.breadcrumb);
  const graph = useAppStore((s) => s.graph);
  const navigateToView = useAppStore((s) => s.navigateToView);

  if (!graph || breadcrumb.length === 0) return null;

  return (
    <div className="breadcrumb">
      {breadcrumb.map((viewId, i) => {
        const view = graph.views.find((v) => v.id === viewId);
        const isLast = i === breadcrumb.length - 1;
        return (
          <span key={viewId}>
            {i > 0 && <span className="sep">›</span>}
            {isLast ? (
              <span style={{ color: "var(--text)" }}>{formatViewTitle(view?.title, viewId)}</span>
            ) : (
              <button onClick={() => navigateToView(viewId, { restoreViewState: true })}>{formatViewTitle(view?.title, viewId)}</button>
            )}
          </span>
        );
      })}
    </div>
  );
}
