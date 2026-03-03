# Sync Proxy Server

Backend ligero para proteger el token de Google Sheets.

## Variables necesarias

1. `SHEETS_WEBHOOK_URL`
2. `SHEETS_WRITE_TOKEN`

Copiar `.env.example` a `.env` y completar esos valores.

## Endpoints

1. `GET /api/health`
2. `POST /api/sheets-sync`

## Desarrollo

1. `npm run dev` (frontend + backend)
2. Frontend usa `/api/sheets-sync` en modo `backend_proxy`.

## Produccion

1. `npm run build`
2. `npm run start`
