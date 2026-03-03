#!/usr/bin/env python3
"""
Genera artefactos de backfill desde un backup JSON de la app.

Salida:
- CSV normalizados por tabla (`sessions.csv`, `sets.csv`, `measurements.csv`, `objectives.csv`, `templates.csv`)
- JSON con lotes listos para webhook (`webhook_backfill_batches.json`)
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Sequence


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def template_day_label(template_day_id: str) -> str:
    return "Dia libre" if template_day_id == "CUSTOM" else f"Dia {template_day_id}"


def load_state(path: Path) -> Dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("state"), dict):
        return payload["state"]
    if isinstance(payload, dict) and isinstance(payload.get("sessions"), list):
        return payload
    raise ValueError("El archivo no contiene un estado compatible (esperado backup con `state` o AppState directo).")


def write_csv(path: Path, rows: List[Dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    header = sorted({column for row in rows for column in row.keys()})
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)


def to_session_rows(state: Dict) -> List[Dict]:
    rows: List[Dict] = []
    for session in state.get("sessions", []):
        template_day_id = session.get("templateDayId", "")
        rows.append(
            {
                "session_id": session.get("id", ""),
                "date": session.get("date", ""),
                "template_day_id": template_day_id,
                "template_day_label": template_day_label(template_day_id),
                "notes": session.get("notes", ""),
                "sets_count": len(session.get("sets", []) or []),
                "is_deleted": 0,
                "created_at": session.get("createdAt", ""),
                "updated_at": session.get("updatedAt", ""),
            }
        )
    return rows


def to_set_rows(state: Dict) -> List[Dict]:
    rows: List[Dict] = []
    for session in state.get("sessions", []):
        template_day_id = session.get("templateDayId", "")
        for set_row in session.get("sets", []) or []:
            rows.append(
                {
                    "set_id": set_row.get("id", ""),
                    "session_id": session.get("id", ""),
                    "date": session.get("date", ""),
                    "template_day_id": template_day_id,
                    "template_day_label": template_day_label(template_day_id),
                    "exercise_id": set_row.get("exerciseId", ""),
                    "set_number": set_row.get("setNumber", ""),
                    "reps": set_row.get("reps", ""),
                    "weight_kg": set_row.get("weightKg", ""),
                    "rir": set_row.get("rir", ""),
                    "is_warmup": 1 if set_row.get("isWarmup") else 0,
                    "is_deleted": 0,
                    "updated_at": session.get("updatedAt", ""),
                }
            )
    return rows


def to_measurement_rows(state: Dict) -> List[Dict]:
    rows: List[Dict] = []
    for measurement in state.get("measurements", []):
        rows.append(
            {
                "date": measurement.get("date", ""),
                "measurement_id": measurement.get("id", ""),
                "weight_kg": measurement.get("weightKg", ""),
                "waist_cm": measurement.get("waistCm", ""),
                "lumbar_pain": measurement.get("lumbarPain", ""),
                "steps": measurement.get("steps", ""),
                "sleep_hours": measurement.get("sleepHours", ""),
                "chest_cm": measurement.get("chestCm", ""),
                "shoulders_cm": measurement.get("shouldersCm", ""),
                "arm_cm": measurement.get("armCm", ""),
                "hips_cm": measurement.get("hipsCm", ""),
            }
        )
    return rows


def to_objective_rows(state: Dict) -> List[Dict]:
    rows: List[Dict] = []
    for objective in state.get("objectives", []):
        rows.append(
            {
                "objective_id": objective.get("id", ""),
                "title": objective.get("title", ""),
                "metric": objective.get("metric", ""),
                "target_value": objective.get("targetValue", ""),
                "unit": objective.get("unit", ""),
                "deadline": objective.get("deadline", ""),
                "status": objective.get("status", ""),
                "notes": objective.get("notes", ""),
                "created_at": objective.get("createdAt", ""),
                "updated_at": objective.get("updatedAt", ""),
            }
        )
    return rows


def to_template_rows(state: Dict) -> List[Dict]:
    rows: List[Dict] = []
    for template in state.get("trainingTemplates", []):
        exercises = template.get("exercises", []) or []
        if not exercises:
            rows.append(
                {
                    "template_key": f"{template.get('id', '')}::__none__",
                    "template_day_id": template.get("id", ""),
                    "template_label": template.get("label", ""),
                    "exercise_id": "__none__",
                    "exercise_name": "",
                    "order": 0,
                    "target_sets": "",
                    "rep_range": "",
                    "rir_range": "",
                    "notes": "",
                    "is_empty": 1,
                }
            )
            continue

        for exercise in exercises:
            exercise_id = exercise.get("exerciseId", "")
            rows.append(
                {
                    "template_key": f"{template.get('id', '')}::{exercise_id}",
                    "template_day_id": template.get("id", ""),
                    "template_label": template.get("label", ""),
                    "exercise_id": exercise_id,
                    "exercise_name": exercise.get("name", ""),
                    "order": exercise.get("order", ""),
                    "target_sets": exercise.get("targetSets", ""),
                    "rep_range": exercise.get("repRange", ""),
                    "rir_range": exercise.get("rirRange", ""),
                    "notes": exercise.get("notes", ""),
                    "is_empty": 0,
                }
            )
    return rows


def to_sync_items(state: Dict) -> List[Dict]:
    items: List[Dict] = []
    generated_at = now_iso()

    for row in to_session_rows(state):
        items.append(
            {
                "entity": "sessions",
                "key": row["session_id"],
                "op": "upsert",
                "updatedAt": row.get("updated_at") or generated_at,
                "data": row,
            }
        )

    for row in to_set_rows(state):
        items.append(
            {
                "entity": "sets",
                "key": row["set_id"],
                "op": "upsert",
                "updatedAt": row.get("updated_at") or generated_at,
                "data": row,
            }
        )

    for row in to_measurement_rows(state):
        items.append(
            {
                "entity": "measurements",
                "key": row["date"],
                "op": "upsert",
                "updatedAt": generated_at,
                "data": row,
            }
        )

    for row in to_objective_rows(state):
        items.append(
            {
                "entity": "objectives",
                "key": row["objective_id"],
                "op": "upsert",
                "updatedAt": row.get("updated_at") or generated_at,
                "data": row,
            }
        )

    for row in to_template_rows(state):
        items.append(
            {
                "entity": "templates",
                "key": row["template_key"],
                "op": "upsert",
                "updatedAt": generated_at,
                "data": row,
            }
        )

    return items


def batches(items: Sequence[Dict], batch_size: int) -> Iterable[List[Dict]]:
    for i in range(0, len(items), batch_size):
        yield list(items[i : i + batch_size])


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera backfill para Google Sheets desde backup local.")
    parser.add_argument("--input", required=True, help="Ruta al backup JSON exportado por la app.")
    parser.add_argument(
        "--out-dir",
        default="output/spreadsheet",
        help="Carpeta de salida para CSV y JSON de lotes (default: output/spreadsheet).",
    )
    parser.add_argument("--batch-size", type=int, default=200, help="Tamano de lote para webhook (default: 200).")
    args = parser.parse_args()

    in_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    state = load_state(in_path)

    sessions = to_session_rows(state)
    sets = to_set_rows(state)
    measurements = to_measurement_rows(state)
    objectives = to_objective_rows(state)
    templates = to_template_rows(state)
    items = to_sync_items(state)

    write_csv(out_dir / "sessions.csv", sessions)
    write_csv(out_dir / "sets.csv", sets)
    write_csv(out_dir / "measurements.csv", measurements)
    write_csv(out_dir / "objectives.csv", objectives)
    write_csv(out_dir / "templates.csv", templates)

    payload = {
        "generated_at": now_iso(),
        "schema_version": state.get("version", 6),
        "counts": {
            "sessions": len(sessions),
            "sets": len(sets),
            "measurements": len(measurements),
            "objectives": len(objectives),
            "templates": len(templates),
            "items": len(items),
        },
        "batches": list(batches(items, max(1, args.batch_size))),
    }

    (out_dir / "webhook_backfill_batches.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Backfill generado en: {out_dir}")
    print(json.dumps(payload["counts"], indent=2))


if __name__ == "__main__":
    main()
