# Third-party source notices

`packages/ui/src/button.tsx`, `card.tsx`, `utils.ts` are adapted from https://github.com/AleksNeStu/ai-real-estate-assistant at commit bb535cc627f30143ea48d1cf807e2f5fd75402f4 (paths apps/web/src/components/ui/{button,card}.tsx and apps/web/src/lib/utils.ts).
Copyright (c) 2025 Alex Nesterovich. MIT. Full license: third-party/ai-real-estate-assistant.LICENSE.
Changes: local import paths and formatting; no upstream backend, authentication proxy, demo identity bypass, valuation or financial forecast has been imported.
All other first-party source in this repository is developed for BDSG Foundation under MIT. Package dependencies retain their own licenses; the lockfile records their exact versions. See docs/REUSE.md.

## Separate infrastructure images

Development storage builds official MinIO sources as separate containers, not as part of the MIT application code. Server commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` ([source](https://github.com/minio/minio/tree/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a)); client commit `7394ce0dd2a80935aded936b09fa12cbb3cb8096` ([source](https://github.com/minio/mc/tree/7394ce0dd2a80935aded936b09fa12cbb3cb8096)). These upstream programs keep their AGPL-3.0 licenses; each image includes the original LICENSE and source/revision labels. They are not relicensed MIT. Preserve corresponding source/license obligations if redistributing those images.
