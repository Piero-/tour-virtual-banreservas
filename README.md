# Tour Virtual Hoyo 20

Aplicacion para manejar categorias A/B, resultados semanales, pagos, final, donaciones, reportes PNG y standings overall.

## Stack

- Frontend: React + Vite
- Backend: ASP.NET Core 8
- Base de datos local: SQLite
- Base de datos en hosting: Postgres via `DATABASE_URL`

## Desarrollo local

Instala dependencias del frontend:

```powershell
cd ClientApp
npm.cmd install
```

Corre el backend:

```powershell
dotnet run --project server/TourVirtual.Api --urls http://localhost:5000
```

En otra terminal, corre React:

```powershell
cd ClientApp
npm.cmd run dev
```

Abre:

```text
http://localhost:5173
```

## Produccion local en un solo servidor

Compila React hacia el `wwwroot` del backend:

```powershell
cd ClientApp
npm.cmd run build:server
```

Luego corre el backend:

```powershell
dotnet run --project server/TourVirtual.Api
```

## Deploy recomendado

### 1. Base de datos

Usa Neon Postgres o Supabase Postgres.

Guarda el connection string como variable de entorno:

```text
DATABASE_URL
```

### 2. Backend en Render

Render puede levantar este repo con Docker usando el archivo `render.yaml`.

Variables de entorno necesarias:

```text
DATABASE_URL=postgres://...
ALLOWED_ORIGINS=https://tu-url-de-vercel.vercel.app,http://localhost:5173
```

### 3. Frontend en Vercel

Configura Vercel con:

```text
Root Directory: ClientApp
Build Command: npm run build
Output Directory: dist
```

Variable de entorno:

```text
VITE_API_BASE_URL=https://tu-backend-en-render.onrender.com
```

## API

### Scorecard vision (optional)

Configure only on the backend (Render Environment), never in Vercel or source control:

```text
OPENAI_API_KEY=your-secret-key
OPENAI_VISION_MODEL=gpt-5.4-mini
```

The model variable is optional. The API key needs Responses write access.
Photo imports send a JPEG (maximum edge 2000 pixels) to OpenAI through an
authenticated backend endpoint. Images and upstream responses are not logged;
requests use `store: false`. Standard provider data policies still apply.
The client validates gross/OUT/IN/relative totals and calculates played-hole par
and the last three played holes. It never applies a score without the existing
import confirmation flow. When vision is unavailable, it falls back to local OCR
and shows the reason. Requests are not automatically retried.
The backend allows two simultaneous requests and 60 photos per user per hour
per server instance (in-memory limit, resets on restart). Set provider project
spending controls separately; this is not a dollar spending cap.

Tests without paid API calls:

```text
node --test ClientApp/scorecard-vision.test.mjs ClientApp/scorecard-ocr.test.mjs ClientApp/photo-import-events.test.mjs
dotnet run --project server/tests/ScorecardVision.Tests
```

- `GET /api/state`
- `PUT /api/state`

El frontend conserva la misma estructura de datos anterior para no perder reglas existentes: categorias A/B, semanas, equipos, pagos, inscripcion, final, donacion, reportes y standings.
