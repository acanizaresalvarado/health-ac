#!/usr/bin/env python3
"""
Reconciliacion entre export local y export de Google Sheets.

Compara por clave de negocio y reporta:
- faltantes en Sheets
- faltantes en local
- claves duplicadas
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, List, Tuple


TABLES = {
    "sessions": {"file": "sessions.csv", "key": "session_id"},
    "sets": {"file": "sets.csv", "key": "set_id"},
    "measurements": {"file": "measurements.csv", "key": "date"},
    "objectives": {"file": "objectives.csv", "key": "objective_id"},
    "templates": {"file": "templates.csv", "key": "template_key"},
}


def read_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        return list(reader)


def index_by_key(rows: List[Dict[str, str]], key: str) -> Tuple[Dict[str, Dict[str, str]], Dict[str, int]]:
    by_key: Dict[str, Dict[str, str]] = {}
    counts: Dict[str, int] = {}
    for row in rows:
        row_key = (row.get(key) or "").strip()
        if not row_key:
            continue
        counts[row_key] = counts.get(row_key, 0) + 1
        if row_key not in by_key:
            by_key[row_key] = row
    return by_key, counts


def summarize_table(local_rows: List[Dict[str, str]], sheets_rows: List[Dict[str, str]], key: str) -> Dict:
    local_idx, local_counts = index_by_key(local_rows, key)
    sheets_idx, sheets_counts = index_by_key(sheets_rows, key)

    local_keys = set(local_idx.keys())
    sheets_keys = set(sheets_idx.keys())

    missing_in_sheets = sorted(local_keys - sheets_keys)
    missing_in_local = sorted(sheets_keys - local_keys)
    duplicated_local = sorted([k for k, count in local_counts.items() if count > 1])
    duplicated_sheets = sorted([k for k, count in sheets_counts.items() if count > 1])

    return {
        "local_rows": len(local_rows),
        "sheets_rows": len(sheets_rows),
        "unique_local_keys": len(local_keys),
        "unique_sheets_keys": len(sheets_keys),
        "missing_in_sheets_count": len(missing_in_sheets),
        "missing_in_local_count": len(missing_in_local),
        "duplicated_local_count": len(duplicated_local),
        "duplicated_sheets_count": len(duplicated_sheets),
        "missing_in_sheets_sample": missing_in_sheets[:25],
        "missing_in_local_sample": missing_in_local[:25],
        "duplicated_local_sample": duplicated_local[:25],
        "duplicated_sheets_sample": duplicated_sheets[:25],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Reconciliacion local vs Google Sheets exports.")
    parser.add_argument(
        "--local-dir",
        required=True,
        help="Carpeta con CSV locales (sessions.csv, sets.csv, measurements.csv, objectives.csv, templates.csv).",
    )
    parser.add_argument(
        "--sheets-dir",
        required=True,
        help="Carpeta con CSV exportados desde Google Sheets con el mismo naming.",
    )
    parser.add_argument("--out", default="output/spreadsheet/reconciliation_report.json", help="Ruta del reporte JSON.")
    args = parser.parse_args()

    local_dir = Path(args.local_dir).expanduser().resolve()
    sheets_dir = Path(args.sheets_dir).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    report = {
        "local_dir": str(local_dir),
        "sheets_dir": str(sheets_dir),
        "tables": {},
    }

    for table_name, config in TABLES.items():
        file_name = config["file"]
        key = config["key"]
        local_rows = read_csv(local_dir / file_name)
        sheets_rows = read_csv(sheets_dir / file_name)
        report["tables"][table_name] = summarize_table(local_rows, sheets_rows, key)

    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Reporte generado: {out_path}")
    print(json.dumps(report["tables"], indent=2))


if __name__ == "__main__":
    main()
