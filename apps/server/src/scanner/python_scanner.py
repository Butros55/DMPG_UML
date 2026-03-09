"""
Python project scanner v2 — scope-aware extraction of modules, classes,
functions, methods, imports, calls, inherits, reads, writes and instantiates.
Optionally uses `jedi` for advanced resolution (graceful fallback).

Usage: python python_scanner.py <project_directory>
Outputs JSON to stdout.
"""

import ast
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

# ── Optional jedi import ──────────────────────────
try:
    import jedi  # type: ignore
    JEDI_AVAILABLE = True
except ImportError:
    JEDI_AVAILABLE = False


# ── File I/O patterns for reads/writes detection ──
READ_CALL_PATTERNS = {
    "read_csv", "read_excel", "read_json", "read_parquet", "read_sql",
    "read_pickle", "read_text", "read_bytes",
    "load", "loads", "loadtxt", "genfromtxt", "safe_load",
}

WRITE_CALL_PATTERNS = {
    "to_csv", "to_excel", "to_json", "to_parquet", "to_pickle",
    "dump", "dumps", "safe_dump",
    "save", "savetxt", "savez", "write_text", "write_bytes",
}


# Directories to skip during scanning (common non-project dirs)
SKIP_DIRS = {
    "__pycache__", ".git", ".hg", ".svn",
    ".venv", "venv", "env", ".env",
    ".tox", ".nox", ".mypy_cache", ".pytest_cache",
    "node_modules", ".eggs", "*.egg-info",
    "build", "dist", ".build",
    "site-packages",
}


def _filtered_py_files(root_path: Path) -> list[Path]:
    """Walk the tree manually so we can skip entire subtrees."""
    result: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root_path):
        # Modify dirnames in-place to skip excluded directories
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS
            and not d.endswith(".egg-info")
        ]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                result.append(Path(dirpath) / fn)
    return result


def scan_directory(root: str) -> dict[str, Any]:
    root_path = Path(root).resolve()
    symbols: list[dict] = []
    edges: list[dict] = []
    symbol_table: dict[str, str] = {}
    class_ids: set[str] = set()
    import_aliases: dict[str, dict[str, str]] = {}
    module_sources: dict[str, str] = {}
    meta = {"files_scanned": 0, "files_failed": 0, "jedi_available": JEDI_AVAILABLE}

    py_files = _filtered_py_files(root_path)

    # ── Phase 1: Collect all definitions ──────────
    for py_file in py_files:
        rel = py_file.relative_to(root_path)
        mod_name = str(rel.with_suffix("")).replace(os.sep, ".")
        mod_id = f"mod:{mod_name}"

        meta["files_scanned"] += 1

        symbols.append({
            "id": mod_id,
            "label": mod_name,
            "kind": "module",
            "file": str(rel),
            "startLine": 1,
        })
        symbol_table[mod_name] = mod_id
        symbol_table[mod_name.split(".")[-1]] = mod_id

        try:
            source = py_file.read_text(encoding="utf-8", errors="replace")
            tree = ast.parse(source, filename=str(rel))
        except SyntaxError:
            meta["files_failed"] += 1
            symbols[-1]["tags"] = ["parse_error"]
            continue

        module_sources[mod_id] = source
        docstring = ast.get_docstring(tree)
        if docstring:
            symbols[-1]["doc"] = {"summary": docstring[:500]}

        import_aliases[mod_id] = {}

        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                cls_id = f"{mod_id}:{node.name}"
                cls_doc = ast.get_docstring(node)
                sym_entry: dict = {
                    "id": cls_id,
                    "label": node.name,
                    "kind": "class",
                    "file": str(rel),
                    "startLine": node.lineno,
                    "endLine": getattr(node, "end_lineno", None),
                    "parentId": mod_id,
                }
                if cls_doc:
                    sym_entry["doc"] = {"summary": cls_doc[:500]}

                bases = [_node_to_str(b) for b in node.bases]
                sym_entry["bases"] = [b for b in bases if b]

                symbols.append(sym_entry)
                edges.append({"source": mod_id, "target": cls_id, "type": "contains"})
                symbol_table[node.name] = cls_id
                symbol_table[f"{mod_name}.{node.name}"] = cls_id
                class_ids.add(cls_id)

                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        meth_id = f"{cls_id}.{item.name}"
                        meth_doc = ast.get_docstring(item)
                        meth_entry: dict = {
                            "id": meth_id,
                            "label": f"{node.name}.{item.name}",
                            "kind": "method",
                            "file": str(rel),
                            "startLine": item.lineno,
                            "endLine": getattr(item, "end_lineno", None),
                            "parentId": cls_id,
                        }
                        params = _extract_params(item)
                        if params or meth_doc:
                            meth_entry["doc"] = {}
                            if meth_doc:
                                meth_entry["doc"]["summary"] = meth_doc[:500]
                            if params:
                                meth_entry["doc"]["inputs"] = params
                        symbols.append(meth_entry)
                        edges.append({"source": cls_id, "target": meth_id, "type": "contains"})
                        symbol_table[f"{node.name}.{item.name}"] = meth_id
                        symbol_table[f"{mod_name}.{node.name}.{item.name}"] = meth_id
                    elif isinstance(item, ast.AnnAssign) and item.target and isinstance(item.target, ast.Name):
                        # Annotated class attribute: x: int = 5
                        attr_name = item.target.id
                        attr_id = f"{cls_id}.{attr_name}"
                        attr_type = _node_to_str(item.annotation) if item.annotation else None
                        attr_entry: dict = {
                            "id": attr_id,
                            "label": f"{node.name}.{attr_name}",
                            "kind": "variable",
                            "file": str(rel),
                            "startLine": item.lineno,
                            "endLine": getattr(item, "end_lineno", item.lineno),
                            "parentId": cls_id,
                        }
                        if attr_type:
                            attr_entry["doc"] = {"inputs": [{"name": attr_name, "type": attr_type}]}
                        symbols.append(attr_entry)
                        edges.append({"source": cls_id, "target": attr_id, "type": "contains"})
                    elif isinstance(item, ast.Assign):
                        # Class-level assignments: x = 5
                        for target in item.targets:
                            if isinstance(target, ast.Name):
                                attr_name = target.id
                                if attr_name.startswith("_") and not attr_name.startswith("__"):
                                    continue  # skip private internals
                                attr_id = f"{cls_id}.{attr_name}"
                                attr_entry: dict = {
                                    "id": attr_id,
                                    "label": f"{node.name}.{attr_name}",
                                    "kind": "constant" if attr_name.isupper() else "variable",
                                    "file": str(rel),
                                    "startLine": item.lineno,
                                    "endLine": getattr(item, "end_lineno", item.lineno),
                                    "parentId": cls_id,
                                }
                                symbols.append(attr_entry)
                                edges.append({"source": cls_id, "target": attr_id, "type": "contains"})

            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_id = f"{mod_id}:{node.name}"
                func_doc = ast.get_docstring(node)
                func_entry: dict = {
                    "id": func_id,
                    "label": node.name,
                    "kind": "function",
                    "file": str(rel),
                    "startLine": node.lineno,
                    "endLine": getattr(node, "end_lineno", None),
                    "parentId": mod_id,
                }
                params = _extract_params(node)
                if params or func_doc:
                    func_entry["doc"] = {}
                    if func_doc:
                        func_entry["doc"]["summary"] = func_doc[:500]
                    if params:
                        func_entry["doc"]["inputs"] = params
                symbols.append(func_entry)
                edges.append({"source": mod_id, "target": func_id, "type": "contains"})
                symbol_table[node.name] = func_id
                symbol_table[f"{mod_name}.{node.name}"] = func_id

    # ── Phase 2: Extract relations (scope-aware) ──
    for py_file in py_files:
        rel = py_file.relative_to(root_path)
        mod_name = str(rel.with_suffix("")).replace(os.sep, ".")
        mod_id = f"mod:{mod_name}"
        if mod_id not in module_sources:
            continue
        source = module_sources[mod_id]
        try:
            tree = ast.parse(source, filename=str(rel))
        except SyntaxError:
            continue

        visitor = _RelationVisitor(
            mod_id=mod_id,
            mod_name=mod_name,
            rel_path=str(rel),
            source=source,
            symbol_table=symbol_table,
            class_ids=class_ids,
            import_aliases=import_aliases.get(mod_id, {}),
        )
        visitor.visit(tree)
        edges.extend(visitor.edges)
        import_aliases[mod_id] = visitor.local_aliases

    # ── Phase 3: Resolve inherits from collected bases ──
    known_sym_ids = {s["id"] for s in symbols}
    for sym in symbols:
        bases = sym.pop("bases", [])
        for base_name in bases:
            target_id = _resolve_name(base_name, symbol_table, {})
            if target_id and target_id in known_sym_ids:
                edges.append({"source": sym["id"], "target": target_id, "type": "inherits"})
            else:
                ext_id = f"ext:{base_name}"
                if not any(s["id"] == ext_id for s in symbols):
                    symbols.append({"id": ext_id, "label": base_name, "kind": "external"})
                edges.append({
                    "source": sym["id"], "target": ext_id,
                    "type": "inherits", "confidence": 0.5,
                })

    # ── Phase 4: Collect external symbols from unresolved edges ──
    all_sym_ids = {s["id"] for s in symbols}
    ext_to_add: dict[str, str] = {}
    for e in edges:
        for endpoint in ("source", "target"):
            eid = e[endpoint]
            if eid.startswith("ext:") and eid not in all_sym_ids and eid not in ext_to_add:
                ext_to_add[eid] = e.get("artifactLabel") or e.get("externalLabel") or eid[4:]
    for eid, elabel in ext_to_add.items():
        symbols.append({"id": eid, "label": elabel, "kind": "external"})

    # ── Phase 5: Clean edges and deduplicate ──
    for e in edges:
        e.pop("artifactLabel", None)
        e.pop("externalLabel", None)

    seen: set[tuple] = set()
    unique_edges: list[dict] = []
    for e in edges:
        key = (e["source"], e["target"], e["type"])
        if key not in seen:
            seen.add(key)
            unique_edges.append(e)

    meta["total_symbols"] = len(symbols)
    meta["total_edges"] = len(unique_edges)

    return {"symbols": symbols, "edges": unique_edges, "meta": meta}


class _RelationVisitor(ast.NodeVisitor):
    """Scope-aware visitor that tracks module → class → function
    and assigns every call/import to the correct source symbol."""

    def __init__(self, mod_id: str, mod_name: str, rel_path: str, source: str,
                 symbol_table: dict[str, str], class_ids: set[str],
                 import_aliases: dict[str, str]):
        self.mod_id = mod_id
        self.mod_name = mod_name
        self.rel_path = rel_path
        self.source = source
        self.symbol_table = symbol_table
        self.class_ids = class_ids
        self.local_aliases: dict[str, str] = dict(import_aliases)
        self.edges: list[dict] = []
        self._scope_stack: list[str] = [mod_id]
        self._open_handle_stack: list[dict[str, str]] = [{}]

    @property
    def _current_scope(self) -> str:
        return self._scope_stack[-1]

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        cls_id = f"{self.mod_id}:{node.name}"
        self._scope_stack.append(cls_id)
        self.generic_visit(node)
        self._scope_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_func(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_func(node)

    def _visit_func(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        parent = self._current_scope
        if parent in self.class_ids:
            func_id = f"{parent}.{node.name}"
        else:
            func_id = f"{self.mod_id}:{node.name}"
        self._scope_stack.append(func_id)
        self._open_handle_stack.append(dict(self._open_handle_stack[-1]))
        self.generic_visit(node)
        self._open_handle_stack.pop()
        self._scope_stack.pop()

    def visit_With(self, node: ast.With) -> None:
        self._visit_with(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self._visit_with(node)

    def _visit_with(self, node: ast.With | ast.AsyncWith) -> None:
        self._open_handle_stack.append(dict(self._open_handle_stack[-1]))
        frame = self._open_handle_stack[-1]
        for item in node.items:
            path = _extract_open_path(item.context_expr, frame)
            if not path or item.optional_vars is None:
                continue
            if isinstance(item.optional_vars, ast.Name):
                frame[item.optional_vars.id] = path
        for stmt in node.body:
            self.visit(stmt)
        self._open_handle_stack.pop()

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            target_id = f"mod:{alias.name}"
            local_name = alias.asname or alias.name
            self.local_aliases[local_name] = target_id
            self.edges.append({
                "source": self.mod_id, "target": target_id, "type": "imports",
                "evidence": _make_evidence(self.rel_path, node),
            })
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if not node.module:
            self.generic_visit(node)
            return
        base_mod = node.module
        if node.level and node.level > 0:
            parts = self.mod_name.split(".")
            if len(parts) >= node.level:
                prefix = ".".join(parts[:-node.level]) if node.level < len(parts) else ""
                base_mod = f"{prefix}.{node.module}" if prefix else node.module

        for alias in (node.names or []):
            if alias.name == "*":
                target_id = f"mod:{base_mod}"
                self.edges.append({
                    "source": self.mod_id, "target": target_id, "type": "imports",
                    "evidence": _make_evidence(self.rel_path, node),
                })
            else:
                local_name = alias.asname or alias.name
                full_name = f"{base_mod}.{alias.name}"
                target_id = (
                    self.symbol_table.get(full_name)
                    or self.symbol_table.get(alias.name)
                    or f"mod:{base_mod}"
                )
                self.local_aliases[local_name] = target_id
                self.edges.append({
                    "source": self.mod_id, "target": target_id, "type": "imports",
                    "evidence": _make_evidence(self.rel_path, node),
                })
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        callee_str = _resolve_call_name(node)
        if callee_str:
            self._process_call(node, callee_str)
        self.generic_visit(node)

    def _process_call(self, node: ast.Call, callee_str: str) -> None:
        evidence = _make_evidence(self.rel_path, node)
        source_id = self._current_scope

        # Detect reads/writes
        rw = _detect_read_write(callee_str)
        if rw:
            artifact_name = _extract_artifact_name(node, callee_str, self._open_handle_stack[-1])
            artifact_id = f"ext:{artifact_name}" if artifact_name else f"ext:{callee_str}"
            self.edges.append({
                "source": source_id, "target": artifact_id, "type": rw,
                "confidence": 0.7, "evidence": evidence,
                "artifactLabel": artifact_name or callee_str,
            })

        # Resolve the callee to a symbol ID
        target_id = _resolve_name(callee_str, self.symbol_table, self.local_aliases)

        # Handle self.method()
        if not target_id and callee_str.startswith("self."):
            method_name = callee_str[5:]
            for scope in reversed(self._scope_stack):
                if scope in self.class_ids:
                    target_id = f"{scope}.{method_name}"
                    break

        if not target_id:
            # Unresolved → external
            if not callee_str.startswith("self."):
                ext_id = f"ext:{callee_str}"
                self.edges.append({
                    "source": source_id, "target": ext_id, "type": "calls",
                    "confidence": 0.5, "evidence": evidence,
                    "externalLabel": callee_str,
                })
            return

        # Check if target is a class → instantiates
        is_instantiation = target_id in self.class_ids
        edge_type = "instantiates" if is_instantiation else "calls"
        self.edges.append({
            "source": source_id, "target": target_id,
            "type": edge_type, "confidence": 0.8, "evidence": evidence,
        })


# ── Helper functions ──────────────────────────────

def _extract_params(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict]:
    params: list[dict] = []
    for arg in node.args.args:
        if arg.arg in ("self", "cls"):
            continue
        p: dict[str, str] = {"name": arg.arg}
        if arg.annotation:
            ann = _node_to_str(arg.annotation)
            if ann:
                p["type"] = ann
        params.append(p)
    return params


def _node_to_str(node: ast.expr) -> Optional[str]:
    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Attribute):
        val = _node_to_str(node.value)
        return f"{val}.{node.attr}" if val else node.attr
    elif isinstance(node, ast.Constant):
        return str(node.value)
    elif isinstance(node, ast.Subscript):
        val = _node_to_str(node.value)
        sl = _node_to_str(node.slice)  # type: ignore
        return f"{val}[{sl}]" if val else None
    elif isinstance(node, ast.Tuple):
        elts = [_node_to_str(e) for e in node.elts]
        return ", ".join(e for e in elts if e)
    return None


def _resolve_call_name(node: ast.Call) -> Optional[str]:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    elif isinstance(func, ast.Attribute):
        parts: list[str] = []
        current: ast.expr = func
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        parts.reverse()
        return ".".join(parts)
    return None


def _resolve_name(name: str, symbol_table: dict[str, str],
                  local_aliases: dict[str, str]) -> Optional[str]:
    if name in symbol_table:
        return symbol_table[name]
    if name in local_aliases:
        return local_aliases[name]
    if "." in name:
        parts = name.split(".")
        first = parts[0]
        rest = ".".join(parts[1:])
        if first in local_aliases:
            resolved_prefix = local_aliases[first]
            for candidate in [f"{resolved_prefix}.{rest}", f"{resolved_prefix}:{rest}"]:
                if candidate in symbol_table:
                    return symbol_table[candidate]
            if rest in symbol_table:
                return symbol_table[rest]
        short = parts[-1]
        if short in symbol_table:
            return symbol_table[short]
    return None


def _detect_read_write(callee: str) -> Optional[str]:
    """Check if a call is a file read or write operation."""
    last_part = callee.split(".")[-1]
    if last_part in READ_CALL_PATTERNS:
        return "reads"
    if last_part in WRITE_CALL_PATTERNS:
        return "writes"
    return None


def _extract_artifact_name(
    node: ast.Call,
    callee: str,
    open_handles: dict[str, str],
) -> Optional[str]:
    candidates = [*node.args, *(kw.value for kw in node.keywords if kw.value is not None)]

    # Most read/write calls pass the path directly as their first argument.
    if node.args:
        direct = _extract_string_literal(node.args[0], open_handles)
        if direct:
            return direct

    # dump()/write() style calls often carry the file handle in a later argument.
    for candidate in candidates:
        resolved = _extract_string_literal(candidate, open_handles)
        if resolved:
            return resolved

    # json.dump(..., open("file.json", "w")) and similar nested open(...) calls.
    for candidate in candidates:
        resolved = _extract_open_path(candidate, open_handles)
        if resolved:
            return resolved

    return None


def _extract_open_path(node: ast.AST, open_handles: dict[str, str]) -> Optional[str]:
    if isinstance(node, ast.Call):
        callee = _resolve_call_name(node)
        if callee == "open" and node.args:
            return _extract_string_literal(node.args[0], open_handles)
    return None


def _extract_string_literal(node: ast.AST, open_handles: dict[str, str]) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value

    if isinstance(node, ast.Name):
        return open_handles.get(node.id)

    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            elif isinstance(value, ast.FormattedValue):
                expr = _node_to_str(value.value)
                parts.append("{" + (expr or "expr") + "}")
        return "".join(parts) if parts else None

    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _extract_string_literal(node.left, open_handles)
        right = _extract_string_literal(node.right, open_handles)
        if left and right:
            return left + right
        if left:
            return left + "{" + (_node_to_str(node.right) or "expr") + "}"
        if right:
            return "{" + (_node_to_str(node.left) or "expr") + "}" + right
        return None

    if isinstance(node, ast.Call):
        return _extract_open_path(node, open_handles)

    return None


def _make_evidence(rel_path: str, node: ast.AST) -> dict:
    ev: dict = {"file": rel_path}
    if hasattr(node, "lineno"):
        ev["startLine"] = node.lineno
    if hasattr(node, "end_lineno"):
        ev["endLine"] = node.end_lineno
    return ev


# ── Entry point ───────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: python_scanner.py <directory>"}))
        sys.exit(1)

    target_dir = sys.argv[1]
    try:
        result = scan_directory(target_dir)
        # Use compact JSON (no indent) to reduce output size for large projects
        json_str = json.dumps(result, separators=(",", ":"))
        sys.stdout.write(json_str)
        sys.stdout.flush()
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        # Write error as JSON to stdout so the Node caller can parse it
        err_payload = json.dumps({
            "error": str(exc),
            "traceback": tb,
            "symbols": [],
            "edges": [],
            "meta": {"files_scanned": 0, "files_failed": 0, "scan_error": str(exc)},
        })
        sys.stderr.write(f"Scanner error: {exc}\n{tb}\n")
        sys.stdout.write(err_payload)
        sys.stdout.flush()
        sys.exit(1)
