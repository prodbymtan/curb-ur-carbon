import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fetchBluebikesFeed } from './src/lib/bluebikesFeed.js'
import { buildPointToPointCommute } from './src/lib/pointToPointServer.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'local-bluebikes-api',
        configureServer(server) {
          server.middlewares.use('/api/bluebikes', async (_request, response) => {
            try {
              const payload = await fetchBluebikesFeed()
              response.setHeader('Content-Type', 'application/json')
              response.end(JSON.stringify(payload))
            } catch (error) {
              response.statusCode = 500
              response.setHeader('Content-Type', 'application/json')
              response.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : 'Local Bluebikes API failed.',
                }),
              )
            }
          })

          server.middlewares.use('/api/commute', async (request, response) => {
            if (request.method !== 'POST') {
              response.statusCode = 405
              response.setHeader('Content-Type', 'application/json')
              response.end(JSON.stringify({ error: 'Use POST for /api/commute.' }))
              return
            }

            try {
              const body = await readJsonBody(request)
              const payload = await buildPointToPointCommute(
                body,
                env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY,
              )
              response.setHeader('Content-Type', 'application/json')
              response.end(JSON.stringify(payload))
            } catch (error) {
              response.statusCode = 500
              response.setHeader('Content-Type', 'application/json')
              response.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : 'Local commute API failed.',
                }),
              )
            }
          })
        },
      },
    ],
  }
})

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''

    request.on('data', chunk => {
      raw += chunk
    })

    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })

    request.on('error', reject)
  })
}
