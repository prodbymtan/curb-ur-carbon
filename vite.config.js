import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fetchBluebikesFeed } from './src/lib/bluebikesFeed.js'

export default defineConfig({
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
      },
    },
  ],
})
