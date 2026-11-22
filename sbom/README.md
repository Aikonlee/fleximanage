# Software bill of materials

CycloneDX 1.7 JSON generated from the committed lockfiles on 2026-11-22.

- `backend.cdx.json` — generated from `backend/package-lock.json` (399 components).
- `frontend.cdx.json` — generated from `frontend/package-lock.json` (109 components).

Regenerate with:

```bash
cd backend  && npx --yes @cyclonedx/cyclonedx-npm --output-file ../sbom/backend.cdx.json
cd frontend && npx --yes @cyclonedx/cyclonedx-npm --output-file ../sbom/frontend.cdx.json
```

At generation time a live `npm audit` for both packages reported 0 vulnerabilities.
The local offline audit cache is incomplete (it contains only test-tooling advisories),
so rely on a live `npm audit`, not `--offline`.
