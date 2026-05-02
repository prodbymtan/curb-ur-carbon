import { buildPointToPointCommute } from '../src/lib/pointToPointServer.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).send(JSON.stringify({ error: 'Use POST for /api/commute.' }))
    return
  }

  try {
    const body = request.body && Object.keys(request.body).length ? request.body : await readJsonBody(request)
    const payload = await buildPointToPointCommute(body, process.env.GOOGLE_MAPS_API_KEY)
    response.setHeader('Content-Type', 'application/json')
    response.status(200).send(JSON.stringify(payload))
  } catch (error) {
    response.setHeader('Content-Type', 'application/json')
    response.status(500).send(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown commute API failure',
      }),
    )
  }
}

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
