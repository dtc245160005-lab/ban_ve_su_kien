# Task T-26: Bỏ chọn ghế tại chỗ

This folder is a standalone copy of the T-25 seat-reservation API and its Java implementation, extended with a seat map UI.

## Run

Requirements: Node.js/npm and the .NET 8 SDK. The API and UI run together; no files or packages from the repository root are required.

From this directory:

```bash
npm install
npm start
```

Open `http://localhost:2026`. `npm run dev` starts the .NET watcher. The Java Servlet WAR and tests remain available under `java-backend/`; use `npm run test:java` or `npm run build:java` when Java 17 and Maven are installed.

## Seat deselection

The page loads the current user's held seat IDs from `GET /api/seat-reservations/mine`. Clicking a held seat on the map or its × action in the summary uses the same guarded handler and sends one `DELETE /api/seat-reservations/{seatId}` request. The map, summary, estimated total, and countdown update optimistically without navigation/reload; a failed DELETE restores the previous state.

The copied API uses an in-memory repository seeded with seats 10, 11, and 12 for demo user 42. `X-Demo-User-Id` is accepted only in the Development environment to let the standalone demo call the T-25 ownership-aware endpoint without another login dependency. It is not an authentication mechanism for production.

The UI countdown is a local 10-minute demo timer; the copied T-25 in-memory API does not persist reservation expiry.

## Source layout

- `TaskT25.Api/`: .NET 8 API and `wwwroot/` UI.
- `TaskT25.Tests/`: copied .NET API tests.
- `java-backend/`: copied Java Servlet WAR and DAO tests.
- `TaskT25.slnx`: standalone .NET solution.