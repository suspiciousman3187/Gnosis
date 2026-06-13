import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

// The map background images (Ambuscade/Odyssey/Sortie + the LE zone bitmaps
// under maps/zones/) are referenced by the shared components as absolute
// `/maps/<file>.png` and live in the WEB app's public dir. The desktop bundles
// its own public dir, so without this they 404. Rather than duplicate ~180 MB
// into desktop/public, serve them from the web tree in dev and copy them into
// the build output - drift-free, single source.
const webMaps = path.resolve(__dirname, '../web/public/maps');

// Best-effort content-type - most maps are .png or .gif. Anything else is
// served as octet-stream so the browser can still load it via <img>.
function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png')  return 'image/png';
  if (ext === '.gif')  return 'image/gif';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

// Recursive directory copy - needed because /maps/zones/ now exists as a
// subdirectory of /maps/ (LE's per-zone bitmaps). The old flat copyFileSync
// loop would `EISDIR` the moment it hit a directory entry.
function copyDir(src: string, dst: string) {
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

function webMapsPlugin(): Plugin {
  return {
    name: 'serve-web-maps',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/maps/')) {
          const rel = decodeURIComponent(req.url.slice('/maps/'.length).split('?')[0]);
          const file = path.join(webMaps, rel);
          if (file.startsWith(webMaps) && existsSync(file) && statSync(file).isFile()) {
            res.setHeader('Content-Type', contentTypeFor(file));
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            createReadStream(file).pipe(res);
            return;
          }
        }
        next();
      });
    },
    closeBundle() {
      if (!existsSync(webMaps)) return;
      copyDir(webMaps, path.resolve(__dirname, 'dist/maps'));
    },
  };
}

function crossOriginIsolationPlugin(): Plugin {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        next();
      });
    },
  };
}

// The desktop app reuses the web app's shared source directly: components and
// lib live in ../web and are imported via the same `@/` alias they use
// internally (so `@/lib/types`, `@/components/RunTabs`, `@/assets/...` all
// resolve into the web tree). No file moves - this is the low-risk seam from
// Phase 0/1 that keeps the live web deploy untouched.
export default defineConfig({
  plugins: [react(), tailwindcss(), webMapsPlugin()],
  // Dedicated port so Gnosis never collides with another Vite project on 5173.
  // strictPort makes a clash fail loudly instead of silently loading the wrong app.
  server: { port: 5183, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../web'),
    },
  },
  build: {
    // Bump from the 500 kB default - we accept a larger main if the
    // VENDOR splits keep it stable, but we still want the warning if
    // a routine main-bundle import drifts past 800 kB.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Manual vendor chunks: keep big dependencies in their OWN chunks
        // so the main bundle hash stays stable as we iterate on app code
        // (the user gets cache hits on chunks they already have). The
        // function form lets us hand specific node_modules paths to specific
        // chunks - anything not matched stays in the auto-split vendor.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Recharts + its d3-* / lodash-es dependencies are the heaviest
            // single tree in the bundle (~150 kB). Only TrendsView + the
            // EncounterView / ContentView chart tabs use it; co-locating
            // those imports keeps the chunk reusable across all three.
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
              return 'recharts';
            }
            // React + React-DOM is the next-largest stable tree. Splitting
            // it lets a fresh deploy invalidate just the app code, not the
            // ~140 kB React runtime that hasn't changed.
            if (id.includes('react-dom') || id.match(/[\\/]react[\\/]/)) {
              return 'react-vendor';
            }
          }
          if (id.includes('/web/lib/parser')) {
            return 'report-parsers';
          }
          return undefined;
        },
      },
    },
  },
});
