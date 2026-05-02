const GBFS_URL = 'https://gbfs.bluebikes.com/gbfs/gbfs.json'

export async function fetchBluebikesFeed() {
  const gbfs = await fetchJson(GBFS_URL)
  const feeds = gbfs.data?.en?.feeds || []
  const stationInformationUrl = feeds.find(feed => feed.name === 'station_information')?.url
  const stationStatusUrl = feeds.find(feed => feed.name === 'station_status')?.url

  if (!stationInformationUrl || !stationStatusUrl) {
    throw new Error('Bluebikes feed did not include station info and status URLs.')
  }

  const [stationInformation, stationStatus] = await Promise.all([
    fetchJson(stationInformationUrl),
    fetchJson(stationStatusUrl),
  ])

  const statusById = new Map(
    (stationStatus.data?.stations || []).map(station => [station.station_id, station]),
  )

  const stations = (stationInformation.data?.stations || [])
    .map(station => {
      const liveStatus = statusById.get(station.station_id)

      return {
        id: station.station_id,
        name: station.name,
        lat: station.lat,
        lng: station.lon,
        capacity: station.capacity || 0,
        bikesAvailable:
          (liveStatus?.num_bikes_available || 0) + (liveStatus?.num_ebikes_available || 0),
        docksAvailable: liveStatus?.num_docks_available || 0,
        isInstalled: liveStatus?.is_installed === 1,
        isRenting: liveStatus?.is_renting === 1,
        isReturning: liveStatus?.is_returning === 1,
        lastReported: liveStatus?.last_reported || stationStatus.last_updated || gbfs.last_updated,
      }
    })
    .filter(station => Number.isFinite(station.lat) && Number.isFinite(station.lng))

  return {
    source: 'live',
    fetchedAt: new Date().toISOString(),
    lastUpdated: stationStatus.last_updated || stationInformation.last_updated || gbfs.last_updated || null,
    stationCount: stations.length,
    stations,
  }
}

async function fetchJson(url) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Bluebikes API request failed with ${response.status}.`)
  }

  return response.json()
}
