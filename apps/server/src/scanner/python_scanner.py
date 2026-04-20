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
import re
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
    "save", "save_to_file", "savetxt", "savez", "write_text", "write_bytes",
}

BUILTIN_TYPE_NAMES = {
    "Any", "Annotated", "AsyncIterator", "Awaitable", "Callable", "ClassVar",
    "Collection", "Coroutine", "Dict", "Final", "FrozenSet", "Generic", "Generator",
    "Iterable", "Iterator", "List", "Literal", "Mapping", "MutableMapping",
    "MutableSequence", "MutableSet", "None", "Optional", "Protocol", "Self",
    "Sequence", "Set", "Tuple", "Type", "TypedDict", "Union",
    "any", "bool", "bytes", "complex", "dict", "float", "frozenset", "int",
    "list", "object", "set", "str", "tuple", "type",
}

# Collection-like wrappers that imply a multiplicity of 0..* at the target endpoint.
MANY_CONTAINER_TYPES = {
    "list", "List", "Sequence", "MutableSequence", "Iterable", "Iterator",
    "Collection", "set", "Set", "FrozenSet", "frozenset", "MutableSet",
    "tuple", "Tuple", "dict", "Dict", "Mapping", "MutableMapping",
    "TypedDict", "deque", "DefaultDict", "OrderedDict", "ChainMap",
    "Generator", "AsyncIterator",
}

# Wrappers that imply a multiplicity of 0..1 at the target endpoint.
OPTIONAL_CONTAINER_TYPES = {"Optional"}

# Names that indicate the base class is an interface / protocol (realization).
INTERFACE_MARKER_SUFFIXES = ("ABC", "Interface", "Protocol", "Mixin", "Base")
INTERFACE_EXACT_NAMES = {"ABC", "Protocol", "Interface", "ABCMeta"}


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
    async_function_ids: set[str] = set()
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
                class_attr_ids: set[str] = set()
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
                        if isinstance(item, ast.AsyncFunctionDef):
                            meth_entry["tags"] = ["async"]
                            async_function_ids.add(meth_id)
                        params = _extract_params(item)
                        returns = _extract_returns(item)
                        if params or returns or meth_doc:
                            meth_entry["doc"] = {}
                            if meth_doc:
                                meth_entry["doc"]["summary"] = meth_doc[:500]
                            if params:
                                meth_entry["doc"]["inputs"] = params
                            if returns:
                                meth_entry["doc"]["outputs"] = returns
                        symbols.append(meth_entry)
                        edges.append({"source": cls_id, "target": meth_id, "type": "contains"})
                        symbol_table[f"{node.name}.{item.name}"] = meth_id
                        symbol_table[f"{mod_name}.{node.name}.{item.name}"] = meth_id

                        for attr in _extract_instance_attributes(item):
                            attr_name = attr["name"]
                            if attr_name.startswith("_") and not attr_name.startswith("__"):
                                continue
                            attr_id = f"{cls_id}.{attr_name}"
                            if attr_id in class_attr_ids:
                                continue

                            attr_entry: dict = {
                                "id": attr_id,
                                "label": f"{node.name}.{attr_name}",
                                "kind": "variable",
                                "file": str(rel),
                                "startLine": attr["line"],
                                "endLine": attr["line"],
                                "parentId": cls_id,
                            }
                            if attr.get("type"):
                                attr_entry["doc"] = {"inputs": [{"name": attr_name, "type": attr["type"]}]}
                            if attr.get("relationType"):
                                attr_entry["relationType"] = attr["relationType"]

                            symbols.append(attr_entry)
                            edges.append({"source": cls_id, "target": attr_id, "type": "contains"})
                            class_attr_ids.add(attr_id)
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
                        class_attr_ids.add(attr_id)
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
                                class_attr_ids.add(attr_id)

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
                if isinstance(node, ast.AsyncFunctionDef):
                    func_entry["tags"] = ["async"]
                    async_function_ids.add(func_id)
                params = _extract_params(node)
                returns = _extract_returns(node)
                if params or returns or func_doc:
                    func_entry["doc"] = {}
                    if func_doc:
                        func_entry["doc"]["summary"] = func_doc[:500]
                    if params:
                        func_entry["doc"]["inputs"] = params
                    if returns:
                        func_entry["doc"]["outputs"] = returns
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
            async_function_ids=async_function_ids,
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
            inheritance_type = _classify_inheritance(base_name)
            target_id = _resolve_name(base_name, symbol_table, {})
            if target_id and target_id in known_sym_ids:
                edges.append({
                    "source": sym["id"], "target": target_id,
                    "type": inheritance_type,
                })
            else:
                ext_id = f"ext:{base_name}"
                if not any(s["id"] == ext_id for s in symbols):
                    external_symbol: dict[str, Any] = {
                        "id": ext_id,
                        "label": base_name,
                        "kind": "external",
                    }
                    if inheritance_type == "realizes":
                        external_symbol["stereotype"] = "interface"
                    symbols.append(external_symbol)
                edges.append({
                    "source": sym["id"], "target": ext_id,
                    "type": inheritance_type, "confidence": 0.5,
                })

    known_sym_ids = {s["id"] for s in symbols}
    edges.extend(_build_structural_class_relations(symbols, symbol_table, known_sym_ids))

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
        evidence = e.get("evidence") or {}
        key = (
            e["source"],
            e["target"],
            e["type"],
            e.get("label"),
            evidence.get("file"),
            evidence.get("startLine"),
            evidence.get("endLine"),
            evidence.get("callKind"),
        )
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
                 async_function_ids: set[str],
                 import_aliases: dict[str, str]):
        self.mod_id = mod_id
        self.mod_name = mod_name
        self.rel_path = rel_path
        self.source = source
        self.symbol_table = symbol_table
        self.class_ids = class_ids
        self.async_function_ids = async_function_ids
        self.local_aliases: dict[str, str] = dict(import_aliases)
        self.edges: list[dict] = []
        self._scope_stack: list[str] = [mod_id]
        self._literal_bindings_stack: list[dict[str, str]] = [{}]
        self._async_scope_stack: list[bool] = [False]
        self._node_stack: list[ast.AST] = []

    @property
    def _current_scope(self) -> str:
        return self._scope_stack[-1]

    @property
    def _current_bindings(self) -> dict[str, str]:
        return self._literal_bindings_stack[-1]

    @property
    def _current_async_scope(self) -> bool:
        return self._async_scope_stack[-1]

    def visit(self, node: ast.AST) -> Any:
        self._node_stack.append(node)
        try:
            return super().visit(node)
        finally:
            self._node_stack.pop()

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
        self._literal_bindings_stack.append(dict(self._literal_bindings_stack[-1]))
        self._async_scope_stack.append(isinstance(node, ast.AsyncFunctionDef))
        _bind_function_defaults(node, self._current_bindings)
        self.generic_visit(node)
        self._async_scope_stack.pop()
        self._literal_bindings_stack.pop()
        self._scope_stack.pop()

    def visit_With(self, node: ast.With) -> None:
        self._visit_with(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self._visit_with(node)

    def _visit_with(self, node: ast.With | ast.AsyncWith) -> None:
        self._literal_bindings_stack.append(dict(self._literal_bindings_stack[-1]))
        frame = self._current_bindings
        for item in node.items:
            if isinstance(item.context_expr, ast.Call):
                callee_str = _resolve_call_name(item.context_expr)
                if callee_str:
                    self._process_call(item.context_expr, callee_str)
            path = _extract_open_path(item.context_expr, frame)
            if not path or item.optional_vars is None:
                continue
            _bind_literal_target(item.optional_vars, path, frame)
        for stmt in node.body:
            self.visit(stmt)
        self._literal_bindings_stack.pop()

    def visit_Assign(self, node: ast.Assign) -> None:
        resolved = _extract_string_literal(node.value, self._current_bindings)
        if resolved:
            for target in node.targets:
                _bind_literal_target(target, resolved, self._current_bindings)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            resolved = _extract_string_literal(node.value, self._current_bindings)
            if resolved:
                _bind_literal_target(node.target, resolved, self._current_bindings)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            target_id = f"mod:{alias.name}"
            local_name = alias.asname or alias.name
            self.local_aliases[local_name] = target_id
            self.edges.append({
                "source": self.mod_id, "target": target_id, "type": "imports",
                "evidence": _make_evidence(self.rel_path, node, self.source),
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
                    "evidence": _make_evidence(self.rel_path, node, self.source),
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
                    "evidence": _make_evidence(self.rel_path, node, self.source),
                })
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        callee_str = _resolve_call_name(node)
        if callee_str:
            self._process_call(node, callee_str)
        self.generic_visit(node)

    def _process_call(self, node: ast.Call, callee_str: str) -> None:
        evidence = _make_evidence(self.rel_path, node, self.source)
        source_id = self._current_scope

        # Detect reads/writes
        rw = _detect_read_write(node, callee_str, self._current_bindings)
        if rw:
            artifact_names = _extract_artifact_names(node, callee_str, self._current_bindings)
            for artifact_name in artifact_names:
                artifact_id = f"ext:{artifact_name}"
                self.edges.append({
                    "source": source_id, "target": artifact_id, "type": rw,
                    "confidence": 0.7, "evidence": evidence,
                    "artifactLabel": artifact_name,
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
                call_kind = _classify_call_kind(
                    node,
                    callee_str,
                    None,
                    self.async_function_ids,
                    self._node_stack,
                    self._current_async_scope,
                )
                if call_kind:
                    evidence["callKind"] = call_kind
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
        if edge_type == "calls":
            call_kind = _classify_call_kind(
                node,
                callee_str,
                target_id,
                self.async_function_ids,
                self._node_stack,
                self._current_async_scope,
            )
            if call_kind:
                evidence["callKind"] = call_kind
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


def _extract_returns(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict]:
    if not node.returns:
        return []
    annotation = _node_to_str(node.returns)
    if not annotation or annotation == "None":
        return []
    return [{"name": "return", "type": annotation}]


def _extract_param_type_map(node: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, str]:
    param_types: dict[str, str] = {}
    for arg in node.args.args:
        if arg.arg in ("self", "cls"):
            continue
        if not arg.annotation:
            continue
        annotation = _node_to_str(arg.annotation)
        if annotation:
            param_types[arg.arg] = annotation
    return param_types


def _extract_instance_attributes(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict[str, str | int]]:
    param_types = _extract_param_type_map(node)
    attrs: dict[str, dict[str, str | int]] = {}

    class _InstanceAttributeVisitor(ast.NodeVisitor):
        def visit_Assign(self, assign_node: ast.Assign) -> None:
            for target in assign_node.targets:
                self._capture(target, getattr(assign_node, "lineno", None), assign_node.value)
            self.generic_visit(assign_node.value)

        def visit_AnnAssign(self, assign_node: ast.AnnAssign) -> None:
            self._capture(
                assign_node.target,
                getattr(assign_node, "lineno", None),
                assign_node.value,
                annotation=assign_node.annotation,
            )
            if assign_node.value is not None:
                self.generic_visit(assign_node.value)

        def _capture(
            self,
            target: ast.AST,
            line: Optional[int],
            value: Optional[ast.AST],
            annotation: Optional[ast.AST] = None,
        ) -> None:
            if not isinstance(target, ast.Attribute):
                return
            if target.attr in attrs:
                return
            if not isinstance(target.value, ast.Name) or target.value.id != "self":
                return

            attr: dict[str, str | int] = {
                "name": target.attr,
                "line": line or getattr(target, "lineno", 1),
            }
            inferred_type = _infer_attribute_type(value, param_types, annotation)
            if inferred_type:
                attr["type"] = inferred_type
            if isinstance(value, ast.Call):
                attr["relationType"] = "composition"
            elif inferred_type:
                attr["relationType"] = "association"
            attrs[target.attr] = attr

    _InstanceAttributeVisitor().visit(node)
    return list(attrs.values())


def _infer_attribute_type(
    value: Optional[ast.AST],
    param_types: dict[str, str],
    annotation: Optional[ast.AST] = None,
) -> Optional[str]:
    if annotation is not None:
        return _node_to_str(annotation)
    if value is None:
        return None
    if isinstance(value, ast.Name):
        return param_types.get(value.id)
    if isinstance(value, ast.Constant):
        if value.value is None:
            return "None"
        if isinstance(value.value, bool):
            return "bool"
        if isinstance(value.value, int):
            return "int"
        if isinstance(value.value, float):
            return "float"
        if isinstance(value.value, str):
            return "str"
    if isinstance(value, ast.List):
        return "list"
    if isinstance(value, ast.Tuple):
        return "tuple"
    if isinstance(value, ast.Dict):
        return "dict"
    if isinstance(value, ast.Set):
        return "set"
    if isinstance(value, ast.Call):
        callee = _resolve_call_name(value)
        if callee:
            return callee.split(".")[-1]
    if isinstance(value, ast.Attribute):
        rendered = _node_to_str(value)
        if rendered:
            return rendered.split(".")[-1]
    return None


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


def _detect_read_write(
    node: ast.Call,
    callee: str,
    literal_bindings: dict[str, str],
) -> Optional[str]:
    """Check if a call is a file read or write operation."""
    last_part = callee.split(".")[-1]
    if last_part in READ_CALL_PATTERNS:
        return "reads"
    if last_part in WRITE_CALL_PATTERNS:
        return "writes"
    if callee == "open":
        mode = _extract_open_mode(node, literal_bindings)
        if mode is None:
            return "reads"
        if any(flag in mode for flag in ("w", "a", "x", "+")):
            return "writes"
        return "reads"
    return None


ASYNC_DISPATCH_CALLS = {
    "asyncio.create_task",
    "create_task",
    "asyncio.ensure_future",
    "ensure_future",
    "loop.create_task",
}


def _classify_call_kind(
    node: ast.Call,
    callee: str,
    target_id: Optional[str],
    async_function_ids: set[str],
    node_stack: list[ast.AST],
    current_async_scope: bool,
) -> str:
    if _is_wrapped_in_async_dispatch(node, node_stack):
        return "async"

    normalized = callee.lower()
    target_name = (target_id or callee).lower()

    if _is_awaited_call(node_stack):
        return "sync"

    if target_id in async_function_ids:
        return "async" if current_async_scope else "sync"

    if _looks_like_async_message_target(normalized, target_name):
        return "async"

    return "sync"


def _is_awaited_call(node_stack: list[ast.AST]) -> bool:
    if len(node_stack) < 2:
        return False
    parent = node_stack[-2]
    return isinstance(parent, ast.Await)


def _is_wrapped_in_async_dispatch(node: ast.Call, node_stack: list[ast.AST]) -> bool:
    if len(node_stack) < 2:
        return False

    for ancestor in reversed(node_stack[:-1]):
        if not isinstance(ancestor, ast.Call):
            continue
        wrapper_name = _resolve_call_name(ancestor)
        if not wrapper_name or wrapper_name.lower() not in ASYNC_DISPATCH_CALLS:
            continue
        if any(arg is node for arg in ancestor.args):
            return True
    return False


def _looks_like_async_message_target(callee: str, target_name: str) -> bool:
    haystack = f"{callee} {target_name}"
    if re.search(r"\b(kafka|queue|broker|pubsub|topic|event|webhook|socket|stream)\b", haystack):
        return True
    return re.search(
        r"\b(publish|emit|dispatch|enqueue|submit|notify|broadcast|schedule|produce|push)\b",
        haystack,
    ) is not None


def _module_name_from_symbol_id(symbol_id: str) -> Optional[str]:
    if not symbol_id.startswith("mod:"):
        return None
    module_name, _, _ = symbol_id[4:].partition(":")
    return module_name or None


def _extract_type_names(type_text: Optional[str]) -> list[str]:
    if not type_text:
        return []

    seen: set[str] = set()
    names: list[str] = []
    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_.]*", type_text.replace("|", " ")):
        short = token.split(".")[-1]
        if token in BUILTIN_TYPE_NAMES or short in BUILTIN_TYPE_NAMES:
            continue
        for candidate in (token, short):
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            names.append(candidate)
    return names


def _infer_target_multiplicity(type_text: Optional[str]) -> str:
    """Derive UML target multiplicity from a type annotation string.

    Examples:
        list[User]      -> "0..*"
        Optional[User]  -> "0..1"
        User | None     -> "0..1"
        User            -> "1"
    """
    if not type_text:
        return "1"

    normalized = type_text.strip()
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*", normalized)
    token_set = set(tokens)

    if token_set & MANY_CONTAINER_TYPES:
        return "0..*"

    if "None" in token_set or token_set & OPTIONAL_CONTAINER_TYPES:
        return "0..1"

    return "1"


def _looks_like_interface_base(base_name: str) -> bool:
    short = base_name.split(".")[-1]
    if short in INTERFACE_EXACT_NAMES:
        return True
    for suffix in INTERFACE_MARKER_SUFFIXES:
        if short.endswith(suffix) and short != suffix:
            return True
    return False


def _classify_inheritance(base_name: str) -> str:
    """Return 'realizes' for interfaces/protocols, else 'inherits'."""
    return "realizes" if _looks_like_interface_base(base_name) else "inherits"


def _resolve_internal_class_name(
    type_name: str,
    owner_class_id: str,
    symbol_table: dict[str, str],
    symbol_index: dict[str, dict[str, Any]],
    known_sym_ids: set[str],
) -> Optional[str]:
    owner_module_name = _module_name_from_symbol_id(owner_class_id)
    short_name = type_name.split(".")[-1]

    candidates: list[str] = []
    if owner_module_name and "." not in type_name:
        candidates.append(f"{owner_module_name}.{type_name}")
    candidates.append(type_name)
    if short_name != type_name:
        candidates.append(short_name)
    if owner_module_name and short_name != type_name:
        candidates.append(f"{owner_module_name}.{short_name}")

    for candidate in candidates:
        target_id = _resolve_name(candidate, symbol_table, {})
        if not target_id or target_id not in known_sym_ids:
            continue
        target_symbol = symbol_index.get(target_id)
        if target_symbol and target_symbol.get("kind") == "class":
            return target_id
    return None


def _build_structural_class_relations(
    symbols: list[dict[str, Any]],
    symbol_table: dict[str, str],
    known_sym_ids: set[str],
) -> list[dict[str, Any]]:
    symbol_index = {symbol["id"]: symbol for symbol in symbols}
    relations: list[dict[str, Any]] = []

    def add_relation(
        source_id: str,
        target_id: str,
        relation_type: str,
        *,
        label: Optional[str],
        file: Optional[str],
        start_line: Optional[int],
        end_line: Optional[int],
        confidence: float,
        source_multiplicity: Optional[str] = None,
        target_multiplicity: Optional[str] = None,
        source_role: Optional[str] = None,
        target_role: Optional[str] = None,
    ) -> None:
        if source_id == target_id:
            return

        relation: dict[str, Any] = {
            "source": source_id,
            "target": target_id,
            "type": relation_type,
            "confidence": confidence,
        }
        if label:
            relation["label"] = label
        if source_multiplicity:
            relation["sourceMultiplicity"] = source_multiplicity
        if target_multiplicity:
            relation["targetMultiplicity"] = target_multiplicity
        if source_role:
            relation["sourceRole"] = source_role
        if target_role:
            relation["targetRole"] = target_role
        if file:
            evidence = {"file": file}
            if start_line is not None:
                evidence["startLine"] = start_line
            if end_line is not None:
                evidence["endLine"] = end_line
            relation["evidence"] = evidence
        relations.append(relation)

    for symbol in symbols:
        parent_id = symbol.get("parentId")
        if not parent_id:
            continue
        owner = symbol_index.get(parent_id)
        if not owner or owner.get("kind") != "class":
            continue

        if symbol.get("kind") in {"variable", "constant"}:
            items = ((symbol.get("doc") or {}).get("inputs") or [])
            relation_type = symbol.get("relationType") or "association"
            label = str(symbol.get("label") or symbol.get("id") or "").split(".")[-1]
            for item in items:
                target_multiplicity = _infer_target_multiplicity(item.get("type"))
                for type_name in _extract_type_names(item.get("type")):
                    target_id = _resolve_internal_class_name(
                        type_name,
                        parent_id,
                        symbol_table,
                        symbol_index,
                        known_sym_ids,
                    )
                    if not target_id:
                        continue
                    add_relation(
                        parent_id,
                        target_id,
                        str(relation_type),
                        label=label,
                        file=symbol.get("file"),
                        start_line=symbol.get("startLine"),
                        end_line=symbol.get("endLine"),
                        confidence=0.84 if relation_type == "association" else 0.88,
                        source_multiplicity="1",
                        target_multiplicity=target_multiplicity,
                        target_role=label,
                    )
            continue

        if symbol.get("kind") != "method":
            continue

        symbol_doc = symbol.get("doc") or {}
        method_name = str(symbol.get("label") or symbol.get("id") or "").split(".")[-1]
        for item in symbol_doc.get("inputs") or []:
            target_multiplicity = _infer_target_multiplicity(item.get("type"))
            for type_name in _extract_type_names(item.get("type")):
                target_id = _resolve_internal_class_name(
                    type_name,
                    parent_id,
                    symbol_table,
                    symbol_index,
                    known_sym_ids,
                )
                if not target_id:
                    continue
                add_relation(
                    parent_id,
                    target_id,
                    "dependency",
                    label=method_name,
                    file=symbol.get("file"),
                    start_line=symbol.get("startLine"),
                    end_line=symbol.get("endLine"),
                    confidence=0.7,
                    target_multiplicity=target_multiplicity,
                )

        for item in symbol_doc.get("outputs") or []:
            target_multiplicity = _infer_target_multiplicity(item.get("type"))
            for type_name in _extract_type_names(item.get("type")):
                target_id = _resolve_internal_class_name(
                    type_name,
                    parent_id,
                    symbol_table,
                    symbol_index,
                    known_sym_ids,
                )
                if not target_id:
                    continue
                add_relation(
                    parent_id,
                    target_id,
                    "dependency",
                    label=method_name,
                    file=symbol.get("file"),
                    start_line=symbol.get("startLine"),
                    end_line=symbol.get("endLine"),
                    confidence=0.66,
                    target_multiplicity=target_multiplicity,
                )

    return relations


def _extract_artifact_names(
    node: ast.Call,
    callee: str,
    literal_bindings: dict[str, str],
) -> list[str]:
    seen: set[str] = set()
    names: list[str] = []

    def add_candidate(value: Optional[str]) -> None:
        if not value:
            return
        normalized = value.strip()
        if not normalized or not _looks_like_artifact_name(normalized):
            return
        if normalized in seen:
            return
        seen.add(normalized)
        names.append(normalized)

    candidates = [*node.args, *(kw.value for kw in node.keywords if kw.value is not None)]

    # Most read/write calls pass the path directly as their first argument.
    if node.args:
        add_candidate(_extract_string_literal(node.args[0], literal_bindings))

    # dump()/write() style calls often carry the file handle in a later argument.
    for candidate in candidates:
        add_candidate(_extract_string_literal(candidate, literal_bindings))

    # json.dump(..., open("file.json", "w")) and similar nested open(...) calls.
    for candidate in candidates:
        add_candidate(_extract_open_path(candidate, literal_bindings))

    return names


def _extract_open_path(node: ast.AST, literal_bindings: dict[str, str]) -> Optional[str]:
    if isinstance(node, ast.Call):
        callee = _resolve_call_name(node)
        if callee == "open" and node.args:
            return _extract_string_literal(node.args[0], literal_bindings)
    return None


def _extract_string_literal(node: ast.AST, literal_bindings: dict[str, str]) -> Optional[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value

    if isinstance(node, ast.Name):
        return literal_bindings.get(node.id)

    if isinstance(node, ast.Attribute):
        key = _node_to_str(node)
        return literal_bindings.get(key) if key else None

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
        left = _extract_string_literal(node.left, literal_bindings)
        right = _extract_string_literal(node.right, literal_bindings)
        if left and right:
            return left + right
        if left:
            return left + "{" + (_node_to_str(node.right) or "expr") + "}"
        if right:
            return "{" + (_node_to_str(node.left) or "expr") + "}" + right
        return None

    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        left = _extract_string_literal(node.left, literal_bindings)
        right = _extract_string_literal(node.right, literal_bindings)
        if left and right:
            return left.rstrip("/\\") + "/" + right.lstrip("/\\")
        return None

    if isinstance(node, ast.Call):
        callee = _resolve_call_name(node)
        if callee == "os.path.join":
            parts = [_extract_string_literal(arg, literal_bindings) for arg in node.args]
            joined = [part.strip("/\\") for part in parts if part]
            if joined:
                head = joined[0]
                tail = joined[1:]
                return "/".join([head.rstrip("/\\"), *tail]) if tail else head
        if callee in {"Path", "pathlib.Path", "PurePath", "pathlib.PurePath"} and node.args:
            return _extract_string_literal(node.args[0], literal_bindings)
        return _extract_open_path(node, literal_bindings)

    return None


def _bind_function_defaults(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    literal_bindings: dict[str, str],
) -> None:
    positional = node.args.args
    defaults = node.args.defaults
    if defaults:
        offset = len(positional) - len(defaults)
        for arg, default in zip(positional[offset:], defaults):
            resolved = _extract_string_literal(default, literal_bindings)
            if resolved:
                literal_bindings[arg.arg] = resolved

    for arg, default in zip(node.args.kwonlyargs, node.args.kw_defaults):
        if default is None:
            continue
        resolved = _extract_string_literal(default, literal_bindings)
        if resolved:
            literal_bindings[arg.arg] = resolved


def _bind_literal_target(
    node: ast.AST,
    value: str,
    literal_bindings: dict[str, str],
) -> None:
    if isinstance(node, (ast.Name, ast.Attribute)):
        key = _node_to_str(node)
        if key:
            literal_bindings[key] = value


def _extract_open_mode(node: ast.Call, literal_bindings: dict[str, str]) -> Optional[str]:
    if len(node.args) > 1:
        mode = _extract_string_literal(node.args[1], literal_bindings)
        if mode:
            return mode

    for keyword in node.keywords:
        if keyword.arg != "mode" or keyword.value is None:
            continue
        mode = _extract_string_literal(keyword.value, literal_bindings)
        if mode:
            return mode

    return None


def _looks_like_artifact_name(value: str) -> bool:
    lowered = value.lower()
    if "/" in value or "\\" in value:
        return True
    return lowered.endswith((
        ".csv", ".tsv", ".json", ".xlsx", ".xls", ".pkl", ".pickle",
        ".parquet", ".joblib", ".txt", ".yaml", ".yml", ".xml",
    ))


def _make_evidence(rel_path: str, node: ast.AST, source: Optional[str] = None) -> dict:
    ev: dict = {"file": rel_path}
    if hasattr(node, "lineno"):
        ev["startLine"] = node.lineno
    if hasattr(node, "end_lineno"):
        ev["endLine"] = node.end_lineno
    if source and hasattr(node, "lineno"):
        try:
            lines = source.splitlines()
            start = max(0, getattr(node, "lineno", 1) - 1)
            end = min(len(lines), getattr(node, "end_lineno", getattr(node, "lineno", 1)))
            snippet = "\n".join(lines[start:end]).strip()
            if snippet:
                ev["snippet"] = snippet[:500]
        except Exception:
            pass
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
