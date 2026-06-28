import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Serves the Vercel-style functions in ./api during `vite` dev,
// so /api/scan works locally without the Vercel CLI.
function apiDevServer(env) {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()

        const route = req.url.split('?')[0].replace(/^\/api\//, '').replace(/\/+$/, '')
        try {
          // Make non-VITE env vars (e.g. ANTHROPIC_API_KEY) available to the handler.
          for (const [k, v] of Object.entries(env)) {
            if (process.env[k] === undefined) process.env[k] = v
          }

          const mod = await server.ssrLoadModule(`/api/${route}.js`)
          const handler = mod.default

          // Parse JSON body.
          let body = {}
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const raw = Buffer.concat(chunks).toString('utf8')
            body = raw ? JSON.parse(raw) : {}
          }
          req.body = body

          // Adapt to the Express-style API the handler expects.
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (obj) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj))
            return res
          }

          await handler(req, res)
        } catch (err) {
          console.error(`[api-dev-server] /api/${route} failed:`, err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message || 'Internal server error' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiDevServer(env)],
  }
})
