# TypeScript Conventions

- Prefer strict TypeScript (`strict: true`) with explicit return types on exported functions.
- Narrow unknown inputs at boundaries instead of casting with `as`.
- Keep modules pure where possible so unit tests run without network or filesystem mocks.
