---
description: Start the development server with auto-rebuild enabled
---

To start developing with auto-rebuild:

1. Open a terminal in the project root.
2. Run the following command:
```bash
bun dev
```

This will start `esbuild` in watch mode, which will monitor your TypeScript files in `src/` and automatically rebuild the files in `dist/` whenever you save changes.
