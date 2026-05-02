import { fetchBluebikesFeed } from '../src/lib/bluebikesFeed.js'

export default async function handler(_request, response) {
  try {
    const payload = await fetchBluebikesFeed()

    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    response.status(200).send(JSON.stringify(payload))
  } catch (error) {
    response.setHeader('Content-Type', 'application/json')
    response.status(500).send(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown Bluebikes API failure',
      }),
    )
  }
}
