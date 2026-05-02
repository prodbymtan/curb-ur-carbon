export async function fetchPointToPointCommute(input) {
  const response = await fetch('/api/commute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || 'The commute API request failed.')
  }

  return payload
}
