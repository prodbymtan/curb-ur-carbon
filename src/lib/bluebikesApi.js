export async function fetchBluebikesFromAppApi() {
  const response = await fetch('/api/bluebikes')
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || 'The Bluebikes API route failed.')
  }

  return payload
}
