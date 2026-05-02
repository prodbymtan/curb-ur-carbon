import { bluebikeStations as fallbackBluebikeStations } from '../data/bluebikes.js'
import {
  departureWindows,
  places,
  priorityPresets,
  stayDurations,
} from '../data/places.js'
import { fetchBluebikesFeed } from './bluebikesFeed.js'

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const GOOGLE_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json'

const CARBON_PER_MILE = {
  driving: 404,
  rideshare: 586,
  transit: 75,
  bus: 150,
  walking: 0,
  biking: 0,
  bluebikes: 8,
}

const MODE_META = {
  driving: { label: 'Driving', icon: '🚗', blurb: 'Live car route from Google Directions.' },
  rideshare: { label: 'Rideshare', icon: '🚕', blurb: 'Door-to-door route with ridehail-style pricing.' },
  t: { label: 'The T', icon: '🚇', blurb: 'Live rail-focused public transit route from Google Directions.' },
  bus: { label: 'Bus', icon: '🚌', blurb: 'Live bus-focused public transit route from Google Directions.' },
  walking: { label: 'Walking', icon: '🚶', blurb: 'Live pedestrian route from Google Directions.' },
  biking: { label: 'Biking', icon: '🚲', blurb: 'Live bicycle route from Google Directions.' },
  bluebikes: { label: 'Bluebikes', icon: '💙', blurb: 'Live dock-to-dock Bluebikes pairing with walking legs.' },
}

export async function buildPointToPointCommute(request, googleMapsApiKey) {
  if (!googleMapsApiKey) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY. Add it to your local env or deployment env settings.')
  }

  const originQuery = request.originQuery?.trim()
  const destinationQuery = request.destinationQuery?.trim()

  if (!originQuery || !destinationQuery) {
    throw new Error('Origin and destination are required.')
  }

  const departure = departureWindows.find(item => item.id === request.departureId) || departureWindows[0]
  const stay = stayDurations.find(item => item.id === request.stayId) || stayDurations[1]
  const priority = priorityPresets.find(item => item.id === request.priorityId) || priorityPresets[0]
  const departureTime = resolveDepartureTime(departure.id)

  const [origin, destination] = await Promise.all([
    geocodeQuery(originQuery, googleMapsApiKey),
    geocodeQuery(destinationQuery, googleMapsApiKey),
  ])

  const originProfile = inferPlaceProfile(origin)
  const destinationProfile = inferPlaceProfile(destination)
  const routeContext = getRouteContext(originProfile, destinationProfile)

  const routeTasks = await Promise.allSettled([
    fetchDirections({
      originQuery,
      destinationQuery,
      apiKey: googleMapsApiKey,
      mode: 'driving',
      departureTime,
    }),
    fetchDirections({
      originQuery,
      destinationQuery,
      apiKey: googleMapsApiKey,
      mode: 'walking',
    }),
    fetchDirections({
      originQuery,
      destinationQuery,
      apiKey: googleMapsApiKey,
      mode: 'bicycling',
    }),
    fetchDirections({
      originQuery,
      destinationQuery,
      apiKey: googleMapsApiKey,
      mode: 'transit',
      departureTime,
      transitMode: 'rail',
    }),
    fetchDirections({
      originQuery,
      destinationQuery,
      apiKey: googleMapsApiKey,
      mode: 'transit',
      departureTime,
      transitMode: 'bus',
    }),
    fetchBluebikesFeed(),
  ])

  const drivingSummary = settledValue(routeTasks[0])
  const walkingSummary = settledValue(routeTasks[1])
  const bikingSummary = settledValue(routeTasks[2])
  const railSummary = settledValue(routeTasks[3])
  const busSummary = settledValue(routeTasks[4])
  const bluebikeFeed = settledValue(routeTasks[5])

  const results = [
    buildDrivingMode({ summary: drivingSummary, stay, destinationProfile }),
    buildRideshareMode({ summary: drivingSummary, departure }),
    buildTransitMode({
      id: 't',
      summary: railSummary,
      fallbackCost: 2.4,
      fallbackCarbon: CARBON_PER_MILE.transit,
      unavailableMessage: 'No rail-focused transit route came back from Google Directions.',
    }),
    buildTransitMode({
      id: 'bus',
      summary: busSummary,
      fallbackCost: 1.7,
      fallbackCarbon: CARBON_PER_MILE.bus,
      unavailableMessage: 'No bus-focused transit route came back from Google Directions.',
    }),
    buildActiveMode({
      id: 'walking',
      summary: walkingSummary,
      carbonPerMile: CARBON_PER_MILE.walking,
      unavailableMessage: 'No walking route came back from Google Directions.',
    }),
    buildActiveMode({
      id: 'biking',
      summary: bikingSummary,
      carbonPerMile: CARBON_PER_MILE.biking,
      unavailableMessage: 'No bicycling route came back from Google Directions.',
    }),
    buildBluebikesMode({
      origin,
      destination,
      feed: bluebikeFeed,
      routeContext,
      averageBikeAccess: (originProfile.bikeAccess + destinationProfile.bikeAccess) / 2,
    }),
  ]

  const availableResults = results.filter(result => result.available)
  if (!availableResults.length) {
    throw new Error('No route results were available for this trip.')
  }

  const scoredResults = availableResults
    .map(result => ({ ...result, score: scoreMode(result, availableResults, priority.id) }))
    .sort((left, right) => right.score - left.score)
  const unavailableResults = results.filter(result => !result.available)
  const orderedResults = [...scoredResults, ...unavailableResults]

  const recommended = scoredResults[0]
  const fastest = lowestBy(scoredResults, item => item.minutes)
  const cheapest = lowestBy(scoredResults, item => item.cost)
  const cleanest = lowestBy(scoredResults, item => item.carbons)
  const driving = scoredResults.find(item => item.id === 'driving') || null

  return {
    origin,
    destination,
    departure,
    stay,
    priority,
    results: orderedResults,
    recommended,
    fastest,
    cheapest,
    cleanest,
    driving,
    summary: buildSummary({ recommended, fastest, cheapest, cleanest, priority, destination }),
    metadata: {
      liveBluebikes: bluebikeFeed?.source === 'live',
      bluebikesUpdatedAt: bluebikeFeed?.lastUpdated || null,
      routingProvider: 'Google Maps Platform',
    },
  }
}

async function geocodeQuery(query, apiKey) {
  const url = new URL(GOOGLE_GEOCODE_URL)
  url.searchParams.set('address', query)
  url.searchParams.set('region', 'us')
  url.searchParams.set('key', apiKey)

  const payload = await fetchJson(url)
  if (payload.status !== 'OK' || !payload.results?.length) {
    throw new Error(buildGoogleStatusMessage({
      apiName: 'Google Geocoding',
      query,
      status: payload.status,
      errorMessage: payload.error_message,
    }))
  }

  const result = payload.results[0]
  return {
    label: result.formatted_address || query,
    query,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    address: result.formatted_address || query,
    placeId: result.place_id || null,
  }
}

async function fetchDirections({ originQuery, destinationQuery, apiKey, mode, departureTime, transitMode }) {
  const url = new URL(GOOGLE_DIRECTIONS_URL)
  url.searchParams.set('origin', originQuery)
  url.searchParams.set('destination', destinationQuery)
  url.searchParams.set('mode', mode)
  url.searchParams.set('key', apiKey)

  if (mode === 'driving' && departureTime) {
    url.searchParams.set('departure_time', departureTime)
  }

  if (mode === 'transit' && departureTime) {
    url.searchParams.set('departure_time', departureTime)
  }

  if (mode === 'transit' && transitMode) {
    url.searchParams.set('transit_mode', transitMode)
  }

  const payload = await fetchJson(url)
  if (payload.status === 'REQUEST_DENIED' || payload.status === 'OVER_DAILY_LIMIT' || payload.status === 'OVER_QUERY_LIMIT') {
    throw new Error(buildGoogleStatusMessage({
      apiName: 'Google Directions',
      query: `${originQuery} -> ${destinationQuery}`,
      status: payload.status,
      errorMessage: payload.error_message,
    }))
  }

  if (payload.status !== 'OK' || !payload.routes?.length) {
    return null
  }

  return summarizeDirectionsRoute(payload)
}

function summarizeDirectionsRoute(payload) {
  const leg = payload.routes?.[0]?.legs?.[0]
  if (!leg) {
    return null
  }

  const lines = (leg.steps || [])
    .filter(step => step.travel_mode === 'TRANSIT' && step.transit_details?.line)
    .map(step => step.transit_details.line.short_name || step.transit_details.line.name || null)
    .filter(Boolean)

  return {
    durationSeconds: leg.duration?.value || 0,
    distanceMiles: (leg.distance?.value || 0) / 1609.34,
    startAddress: leg.start_address || null,
    endAddress: leg.end_address || null,
    lines: [...new Set(lines)],
    routeWarnings: payload.routes?.[0]?.warnings || [],
    source: 'live',
  }
}

function buildDrivingMode({ summary, stay, destinationProfile }) {
  if (!summary) {
    return unavailableMode('driving', 'No driving route came back from Google Directions.')
  }

  return createMode({
    id: 'driving',
    minutes: summary.durationSeconds / 60,
    cost: summary.distanceMiles * 0.26 + destinationProfile.parkingRate * stay.hours,
    carbons: summary.distanceMiles * CARBON_PER_MILE.driving,
    tags: [
      `${summary.distanceMiles.toFixed(1)} mi route`,
      `parking $${destinationProfile.parkingRate.toFixed(2)}/hr`,
      'Google Directions live',
    ],
    note: `Live driving route plus parking at the destination profile nearest to ${destinationProfile.name}.`,
  })
}

function buildRideshareMode({ summary, departure }) {
  if (!summary) {
    return unavailableMode('rideshare', 'No road route came back from Google Directions for rideshare estimation.')
  }

  const minutes = summary.durationSeconds / 60 + departure.rideshareWait
  const cost = (3.5 + summary.distanceMiles * 2.35 + (summary.durationSeconds / 60) * 0.32) * departure.surgeMultiplier

  return createMode({
    id: 'rideshare',
    minutes,
    cost,
    carbons: summary.distanceMiles * CARBON_PER_MILE.rideshare,
    tags: [`pickup wait ${departure.rideshareWait} min`, 'Google Directions live', 'surge modeled'],
    note: 'Built from the live driving route, then priced like a ridehail trip with pickup time and surge pressure.',
  })
}

function buildTransitMode({ id, summary, fallbackCost, fallbackCarbon, unavailableMessage }) {
  if (!summary) {
    return unavailableMode(id, unavailableMessage)
  }

  return createMode({
    id,
    minutes: summary.durationSeconds / 60,
    cost: fallbackCost,
    carbons: summary.distanceMiles * fallbackCarbon,
    tags: [...summary.lines.slice(0, 3), 'Google Directions live'],
    note: `Live transit route from Google Directions using a ${id === 't' ? 'rail-first' : 'bus-first'} transit filter.`,
  })
}

function buildActiveMode({ id, summary, carbonPerMile, unavailableMessage }) {
  if (!summary) {
    return unavailableMode(id, unavailableMessage)
  }

  return createMode({
    id,
    minutes: summary.durationSeconds / 60,
    cost: 0,
    carbons: summary.distanceMiles * carbonPerMile,
    tags: [`${summary.distanceMiles.toFixed(1)} mi route`, 'Google Directions live'],
    note: `Live ${id} route from Google Directions.`,
  })
}

function buildBluebikesMode({ origin, destination, feed, routeContext, averageBikeAccess }) {
  const stations = feed?.stations?.length ? feed.stations : fallbackBluebikeStations
  const rawOriginOptions = nearestStations(origin, stations, 12)
  const rawDestinationOptions = nearestStations(destination, stations, 12)
  const originOptions = feed?.stations?.length
    ? rawOriginOptions.filter(station => station.isInstalled && station.isRenting && station.bikesAvailable > 0)
    : rawOriginOptions
  const destinationOptions = feed?.stations?.length
    ? rawDestinationOptions.filter(station => station.isInstalled && station.isReturning && station.docksAvailable > 0)
    : rawDestinationOptions

  let bestPath = null

  for (const startStation of originOptions) {
    for (const endStation of destinationOptions) {
      if (startStation.id === endStation.id) {
        continue
      }

      const accessWalkMiles = startStation.distanceMiles * 1.12
      const egressWalkMiles = endStation.distanceMiles * 1.12
      const dockToDockMiles = Math.max(
        haversineMiles(startStation.lat, startStation.lng, endStation.lat, endStation.lng) * routeContext.bikeDetour,
        0.18,
      )
      const bikeSpeed = 8.4 + Math.max(0, averageBikeAccess - 3) * 0.55
      const accessMinutes = (accessWalkMiles / 3) * 60
      const egressMinutes = (egressWalkMiles / 3) * 60
      const bikeMinutes = (dockToDockMiles / bikeSpeed) * 60
      const dockOpsMinutes = routeContext.bikeSetupMinutes + 4
      const walkPenalty =
        Math.max(0, accessWalkMiles - 0.22) * 14 + Math.max(0, egressWalkMiles - 0.22) * 14
      const score = accessMinutes + egressMinutes + bikeMinutes + dockOpsMinutes + walkPenalty

      const candidate = {
        startStation,
        endStation,
        accessWalkMiles,
        egressWalkMiles,
        dockToDockMiles,
        minutes: accessMinutes + egressMinutes + bikeMinutes + dockOpsMinutes,
        score,
      }

      if (!bestPath || candidate.score < bestPath.score) {
        bestPath = candidate
      }
    }
  }

  if (!bestPath) {
    return unavailableMode(
      'bluebikes',
      feed?.stations?.length
        ? 'Live Bluebikes data found no workable bike/dock pairing right now.'
        : 'Fallback Bluebikes station data found no workable bike/dock pairing.',
    )
  }

  const longWalkRisk = bestPath.accessWalkMiles > 0.45 || bestPath.egressWalkMiles > 0.45
  const bothEndsDocked = bestPath.accessWalkMiles <= 0.25 && bestPath.egressWalkMiles <= 0.25
  const tripCost = bestPath.minutes <= 30 ? 2.95 : bestPath.minutes <= 60 ? 4.25 : 6.5

  return createMode({
    id: 'bluebikes',
    minutes: bestPath.minutes,
    cost: tripCost,
    carbons: bestPath.dockToDockMiles * CARBON_PER_MILE.bluebikes,
    tags: [
      `walk ${formatMinutes((bestPath.accessWalkMiles / 3) * 60)} to dock`,
      `bike ${bestPath.dockToDockMiles.toFixed(1)} mi`,
      `walk ${formatMinutes((bestPath.egressWalkMiles / 3) * 60)} after docking`,
      feed?.stations?.length
        ? `${bestPath.startStation.bikesAvailable} bikes, ${bestPath.endStation.docksAvailable} docks live`
        : 'fallback dock dataset',
    ],
    note: `${bestPath.startStation.name} to ${bestPath.endStation.name}. ${bothEndsDocked ? 'Docks are close at both ends.' : longWalkRisk ? 'This route works, but the walking legs are a real part of the trip.' : 'The dock access is manageable on both ends.'}`,
  })
}

function unavailableMode(id, note) {
  return {
    id,
    label: MODE_META[id].label,
    icon: MODE_META[id].icon,
    blurb: MODE_META[id].blurb,
    available: false,
    minutes: Number.POSITIVE_INFINITY,
    cost: Number.POSITIVE_INFINITY,
    carbons: Number.POSITIVE_INFINITY,
    tags: ['unavailable'],
    note,
  }
}

function createMode({ id, minutes, cost, carbons, tags, note }) {
  return {
    id,
    label: MODE_META[id].label,
    icon: MODE_META[id].icon,
    blurb: MODE_META[id].blurb,
    available: true,
    minutes: roundTo(minutes, 0),
    cost: roundTo(cost, 2),
    carbons: roundTo(carbons, 0),
    tags,
    note,
  }
}

function inferPlaceProfile(point) {
  return lowestBy(places, place => haversineMiles(point.lat, point.lng, place.lat, place.lng))
}

function getRouteContext(originProfile, destinationProfile) {
  const isEastBostonTrip =
    (originProfile.id === 'east-boston' && destinationProfile.id !== 'east-boston') ||
    (destinationProfile.id === 'east-boston' && originProfile.id !== 'east-boston')
  const charlesBankIds = ['cambridge', 'somerville']
  const isCharlesCrossing =
    charlesBankIds.includes(originProfile.id) !== charlesBankIds.includes(destinationProfile.id)

  if (isEastBostonTrip) {
    return {
      bikeDetour: 1.72,
      bikeSetupMinutes: 7,
    }
  }

  if (isCharlesCrossing) {
    return {
      bikeDetour: 1.3,
      bikeSetupMinutes: 5,
    }
  }

  return {
    bikeDetour: 1.18,
    bikeSetupMinutes: 4,
  }
}

function buildSummary({ recommended, fastest, cheapest, cleanest, priority, destination }) {
  if (priority.id === 'fastest') {
    return `${recommended.label} wins on raw travel time for this trip into ${destination.label}, based on the live route results that came back.`
  }

  if (priority.id === 'cheapest') {
    return `${recommended.label} is the budget move here at roughly ${formatCurrency(recommended.cost)}, using live route distance and time where available.`
  }

  if (priority.id === 'cleanest') {
    return `${recommended.label} keeps the carbon footprint lowest on this route at about ${formatCarbon(recommended.carbons)}.`
  }

  return `${recommended.label} gives you the best balance of time, cost, and emissions for this route. ${fastest.label} is the speed king, ${cheapest.label} is the money saver, and ${cleanest.label} wins on carbon.`
}

function scoreMode(mode, modes, priorityId) {
  const timeScore = normalizeInverse(mode.minutes, modes.map(item => item.minutes))
  const costScore = normalizeInverse(mode.cost, modes.map(item => item.cost))
  const carbonScore = normalizeInverse(mode.carbons, modes.map(item => item.carbons))

  if (priorityId === 'fastest') {
    return timeScore * 0.72 + costScore * 0.14 + carbonScore * 0.14
  }

  if (priorityId === 'cheapest') {
    return costScore * 0.72 + timeScore * 0.18 + carbonScore * 0.1
  }

  if (priorityId === 'cleanest') {
    return carbonScore * 0.72 + timeScore * 0.18 + costScore * 0.1
  }

  return timeScore * 0.38 + costScore * 0.25 + carbonScore * 0.37
}

function resolveDepartureTime(departureId) {
  const now = new Date()
  const date = new Date(now)
  const morning = 8
  const midday = 13
  const evening = 18

  if (departureId === 'morning') {
    date.setHours(morning, 0, 0, 0)
    if (date <= now) {
      date.setDate(date.getDate() + 1)
    }
    return Math.floor(date.getTime() / 1000).toString()
  }

  if (departureId === 'midday') {
    date.setHours(midday, 0, 0, 0)
    if (date <= now) {
      date.setDate(date.getDate() + 1)
    }
    return Math.floor(date.getTime() / 1000).toString()
  }

  if (departureId === 'evening') {
    date.setHours(evening, 0, 0, 0)
    if (date <= now) {
      date.setDate(date.getDate() + 1)
    }
    return Math.floor(date.getTime() / 1000).toString()
  }

  const day = date.getDay()
  const daysUntilSaturday = (6 - day + 7) % 7 || 7
  date.setDate(date.getDate() + daysUntilSaturday)
  date.setHours(midday, 0, 0, 0)
  return Math.floor(date.getTime() / 1000).toString()
}

async function fetchJson(url) {
  const response = await fetch(url)
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error_message || `Google request failed with ${response.status}.`)
  }

  return payload
}

function buildGoogleStatusMessage({ apiName, query, status, errorMessage }) {
  if (errorMessage) {
    return `${apiName} error for "${query}": ${errorMessage}`
  }

  if (status === 'ZERO_RESULTS') {
    return `${apiName} could not resolve "${query}".`
  }

  return `${apiName} failed for "${query}" with status ${status || 'UNKNOWN_ERROR'}.`
}

function settledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

function nearestStations(point, stations, limit) {
  return stations
    .map(station => ({
      ...station,
      distanceMiles: haversineMiles(point.lat, point.lng, station.lat, station.lng),
    }))
    .sort((left, right) => left.distanceMiles - right.distanceMiles)
    .slice(0, limit)
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRadians = degrees => (degrees * Math.PI) / 180
  const earthRadiusMiles = 3958.8
  const deltaLat = toRadians(lat2 - lat1)
  const deltaLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function lowestBy(items, accessor) {
  return items.reduce((best, candidate) => (accessor(candidate) < accessor(best) ? candidate : best), items[0])
}

function normalizeInverse(value, values) {
  const min = Math.min(...values)
  const max = Math.max(...values)

  if (max === min) {
    return 1
  }

  return 1 - (value - min) / (max - min)
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function formatMinutes(minutes) {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = Math.round(minutes % 60)

  return remainingMinutes === 0 ? `${hours} hr` : `${hours} hr ${remainingMinutes} min`
}

function formatCurrency(amount) {
  return amount === 0 ? '$0' : `$${amount.toFixed(2)}`
}

function formatCarbon(grams) {
  if (grams <= 0) {
    return 'near zero'
  }

  if (grams < 1000) {
    return `${Math.round(grams)} g CO2e`
  }

  return `${(grams / 1000).toFixed(2)} kg CO2e`
}
