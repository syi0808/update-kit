# update-kit — Project Conventions

## Package Manager

Use **pnpm** exclusively. Do not use npm or yarn.

## Scripts

| Command            | Description                        |
|--------------------|------------------------------------|
| `pnpm build`       | Build with tsup (ESM + CJS dual)  |
| `pnpm test`        | Run tests with vitest              |
| `pnpm test:watch`  | Run tests in watch mode            |
| `pnpm lint`        | Type-check with `tsc --noEmit`     |

## Code Style

- All code, comments, and documentation must be written in **English**.
- Task specs in `docs/tasks/` are written in Korean — that is intentional. Generated source code must still be English.
