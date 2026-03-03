# Spreadsheet Ops Scripts

Scripts de soporte para backfill y QA analitico de Google Sheets.

## 1) Generar backfill desde backup JSON

```bash
python3 scripts/spreadsheet/backfill_payload.py \
  --input "/ruta/health-tracker-backup-YYYY-MM-DD.json" \
  --out-dir "output/spreadsheet" \
  --batch-size 200
```

Genera:

- `output/spreadsheet/sessions.csv`
- `output/spreadsheet/sets.csv`
- `output/spreadsheet/measurements.csv`
- `output/spreadsheet/objectives.csv`
- `output/spreadsheet/templates.csv`
- `output/spreadsheet/webhook_backfill_batches.json`

## 2) Reconciliar local vs Sheets

```bash
python3 scripts/spreadsheet/reconcile_exports.py \
  --local-dir "output/spreadsheet" \
  --sheets-dir "/ruta/exports-desde-google-sheets" \
  --out "output/spreadsheet/reconciliation_report.json"
```

El reporte incluye faltantes y duplicados por tabla/clave.
