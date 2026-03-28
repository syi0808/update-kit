import { defineConfig } from 'pubm'
import { externalVersionSync } from '@pubm/plugin-external-version-sync'

export default defineConfig({
  versioning: 'fixed',
  packages: [
    { path: '.', registries: ['npm', 'jsr'] },
    { path: 'rust/crates/update-kit', registries: ['crates'] },
    { path: 'rust/crates/update-kit-cli', registries: ['crates'] },
  ],
  plugins: [
    externalVersionSync({
      targets: [
        { file: 'plugins/update-kit-plugin/.claude-plugin/plugin.json', jsonPath: 'version' },
      ],
    }),
  ],
})
