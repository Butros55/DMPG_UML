"""
Python project scanner — extracts modules, classes, functions, imports and simple calls
using the ast module. Outputs JSON to stdout.
Usage: python python_scanner.py <project_directory>
"""

import ast
import json
import os
import sys
from pathlib import Path


def scan_directory(root: str):
    root_path = Path(root).resolve()
    symbols = []
    edges = []
    module_map = {}  # file -> module_id

    py_files = sorted(root_path.rglob("*.py"))

    for py_file in py_files:
        rel = py_file.relative_to(root_path)
        mod_name = str(rel.with_suffix("")).replace(os.sep, ".")

        mod_id = f"mod:{mod_name}"
        module_map[str(rel)] = mod_id

        symbols.append({
            "id": mod_id,
            "label": mod_name,
            "kind": "module",
            "file": str(rel),
            "startLine": 1,
        })

        try:
            source = py_file.read_text(encoding="utf-8", errors="replace")
            tree = ast.parse(source, filename=str(rel))
        except SyntaxError:
            continue

        # Collect class-level function names to distinguish top-level vs methods
        class_method_ids = set()
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, ast.ClassDef):
                cls_id = f"{mod_id}:{node.name}"
                symbols.append({
                    "id": cls_id,
                    "label": node.name,
                    "kind": "class",
                    "file": str(rel),
                    "startLine": node.lineno,
                    "endLine": node.end_lineno,
                    "parentId": mod_id,
                })
                edges.append({"source": mod_id, "target": cls_id, "type": "contains"})

                # methods
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        meth_id = f"{cls_id}.{item.name}"
                        class_method_ids.add(meth_id)
                        symbols.append({
                            "id": meth_id,
                            "label": f"{node.name}.{item.name}",
                            "kind": "method",
                            "file": str(rel),
                            "startLine": item.lineno,
                            "endLine": item.end_lineno,
                            "parentId": cls_id,
                        })
                        edges.append({"source": cls_id, "target": meth_id, "type": "contains"})

            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                # top-level function (direct child of module)
                func_id = f"{mod_id}:{node.name}"
                if func_id not in class_method_ids and not any(s["id"] == func_id for s in symbols):
                    symbols.append({
                        "id": func_id,
                        "label": node.name,
                        "kind": "function",
                        "file": str(rel),
                        "startLine": node.lineno,
                        "endLine": node.end_lineno,
                        "parentId": mod_id,
                    })
                    edges.append({"source": mod_id, "target": func_id, "type": "contains"})

        # Extract imports and calls (walk full tree)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target_id = f"mod:{alias.name}"
                    edges.append({"source": mod_id, "target": target_id, "type": "imports"})

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    target_id = f"mod:{node.module}"
                    edges.append({"source": mod_id, "target": target_id, "type": "imports"})

            elif isinstance(node, ast.Call):
                callee = _resolve_call(node)
                if callee:
                    edges.append({
                        "source": mod_id,
                        "target": callee,
                        "type": "calls",
                    })

    # Resolve call targets to known symbol IDs where possible
    known_ids = {s["id"] for s in symbols}
    known_labels = {}
    for s in symbols:
        known_labels.setdefault(s["label"], s["id"])
        # also short name
        short = s["label"].split(".")[-1]
        known_labels.setdefault(short, s["id"])

    resolved_edges = []
    for e in edges:
        target = e["target"]
        if target in known_ids:
            resolved_edges.append(e)
        elif target in known_labels:
            e["target"] = known_labels[target]
            resolved_edges.append(e)
        elif target.startswith("mod:") or e["type"] == "contains":
            resolved_edges.append(e)
        # else: drop unresolved calls

    # Deduplicate edges
    seen = set()
    unique_edges = []
    for e in resolved_edges:
        key = (e["source"], e["target"], e["type"])
        if key not in seen:
            seen.add(key)
            unique_edges.append(e)

    return {"symbols": symbols, "edges": unique_edges}


def _resolve_call(node: ast.Call) -> str | None:
    """Try to extract the called name as a string."""
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    elif isinstance(func, ast.Attribute):
        parts = []
        current = func
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        parts.reverse()
        return ".".join(parts)
    return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: python_scanner.py <directory>"}))
        sys.exit(1)

    result = scan_directory(sys.argv[1])
    print(json.dumps(result, indent=2))
