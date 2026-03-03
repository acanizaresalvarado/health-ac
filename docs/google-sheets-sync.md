# Google Sheets Sync (Backend Proxy)

## Objetivo

Evitar guardar el token de Google Sheets en el frontend.

Arquitectura final:

1. App web guarda local-first (IndexedDB/localStorage).
2. La app encola operaciones de sync.
3. La app llama al backend `POST /api/sheets-sync`.
4. El backend inyecta `SHEETS_WRITE_TOKEN` y reenvia al webhook de Apps Script.
5. Apps Script hace upsert en tu Spreadsheet.

Notas de consistencia:

1. `sessions` y `sets` incluyen columna `is_deleted` (`0/1`) para soft-delete.
2. Al editar una sesion historica y quitar series, esas series se sincronizan como `is_deleted=1`.
3. Al borrar una sesion del dia desde la app, sesion y sets quedan con `is_deleted=1`.

## Seguridad

1. El Spreadsheet se mantiene privado.
2. El token de escritura solo existe en backend (`.env`).
3. El frontend no necesita token en modo `backend_proxy`.

## Setup rapido

1. Copia `.env.example` a `.env`.
2. Completa:
   - `SHEETS_WEBHOOK_URL`
   - `SHEETS_WRITE_TOKEN`
3. Levanta proyecto:
   - `npm run dev` (inicia frontend + backend)
4. En app (`Exportar > Google Sheets Sync`):
   - `Modo de sync`: `Backend proxy (recomendado)`
   - `Endpoint backend`: `/health-ac/api/sheets-sync` (default con base actual)
   - `Habilitar sync`: ON
   - `Auto-sync al guardar`: ON
5. Prueba:
   - guarda una sesion,
   - revisa hojas `sessions` y `sets`.

## Endpoints backend

1. `GET /api/health`
2. `POST /api/sheets-sync`

Con base `/health-ac/` tambien responden:

1. `GET /health-ac/api/health`
2. `POST /health-ac/api/sheets-sync`

Ambos se sirven por `server/index.mjs`.

## Hojas esperadas en Spreadsheet

Se crean automaticamente si no existen:

1. `sessions`
2. `sets`
3. `measurements`
4. `objectives`
5. `templates`
6. `sync_log`

## Modo avanzado (direct_webhook)

Sigue disponible para debugging:

1. `Modo`: `Directo a Apps Script`
2. `Endpoint`: URL `.../exec`
3. Guardar token en frontend

No recomendado para produccion.
