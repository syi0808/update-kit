import { defineConfig } from 'pubm'

export default defineConfig({
  versioning: 'independent',
  packages: [
    { path: '.', registries: ['npm', 'jsr'] },
    { path: 'rust/crates/update-kit', registries: ['crates'] },
    { path: 'rust/crates/update-kit-cli', registries: ['crates'] },
  ],
})
