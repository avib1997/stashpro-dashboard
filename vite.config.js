import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import Anthropic from '@anthropic-ai/sdk'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
  plugins: [
    react(),
    {
      name: 'anthropic-dev-proxy',
      configureServer(server) {
        const client = new Anthropic({ apiKey: env.VITE_ANTHROPIC_API_KEY })

        server.middlewares.use('/api/ai', async (req, res) => {
          let body = ''
          req.on('data', (chunk) => (body += chunk))
          req.on('end', async () => {
            try {
              const msg = await client.messages.create(JSON.parse(body))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(msg))
            } catch (e) {
              console.error('[anthropic-proxy]', e)
              res.statusCode = e.status || 500
              res.end(JSON.stringify({ error: e.message }))
            }
          })
        })
      }
    }
  ]
  }
})
