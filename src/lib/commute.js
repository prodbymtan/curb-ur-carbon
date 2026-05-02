import { bluebikeStations as fallbackBluebikeStations } from '../data/bluebikes.js'

const CARBON_PER_MILE = {
  driving: 404,
  rideshare: 586,
  transit: 75,
  bus: 150,
  walking: 0,
  biking: 0,
  bluebikes: 8,
}

const ICONS = {
  driving: '🚗',
  rideshare: '🚕',
  t: '🚇',
  bus: '🚌',
  walking: '🚶',
  biking: '🚲',
  bluebikes: '💙',
}

export function estimateCommute({
  origin,
  destination,
  departure,
  stay,
  priority,
  bluebikeStations = null,
  bluebikeLiveData = false,
}) {
  const directMiles = Math.max(haversineMiles(origin.lat, origin.lng, destination.lat, destination.lng), 0.35)
  const sameLine = origin.tLines.some(line => destination.tLines.includes(line))
  const averageBikeAccess = (origin.bikeAccess + destination.bikeAccess) / 2
  const averageBusAccess = (origin.busAccess + destination.busAccess) / 2
  const averageTAccess = (origin.tAccess + destination.tAccess) / 2
  const routeContext = getRouteContext(origin, destination)

  const drivingRouteMiles = directMiles * routeContext.driveDetour
  const drivingBaseMinutes = (drivingRouteMiles / (17 / departure.driveMultiplier)) * 60
  const parkingMinutes = clamp(4, 22, destination.parkingPressure * 2.6 * departure.parkingMultiplier)
  const circlingMiles = parkingMinutes * 0.12
  const driving = createMode({
    id: 'driving',
    label: 'Driving',
    blurb: 'Best when you need door-to-door flexibility.',
    icon: ICONS.driving,
    minutes: drivingBaseMinutes + parkingMinutes,
    cost: drivingRouteMiles * 0.26 + destination.parkingRate * stay.hours,
    carbons: (drivingRouteMiles + circlingMiles) * CARBON_PER_MILE.driving,
    tags: [`parking hunt ${Math.round(parkingMinutes)} min`, `${destination.name} parking $${destination.parkingRate.toFixed(2)}/hr`],
    note: `This includes traffic plus a realistic parking search near ${destination.name}.`,
  })

  const rideshare = createMode({
    id: 'rideshare',
    label: 'Rideshare',
    blurb: 'Skips parking but adds pickup time and surge pricing.',
    icon: ICONS.rideshare,
    minutes: drivingBaseMinutes * 1.05 + departure.rideshareWait + destination.parkingPressure * 0.5,
    cost: (3.5 + drivingRouteMiles * 2.35 + drivingBaseMinutes * 0.32) * departure.surgeMultiplier,
    carbons: drivingRouteMiles * CARBON_PER_MILE.rideshare,
    tags: ['pickup wait included', 'surge-sensitive'],
    note: 'Modeled higher than personal driving because ridehail trips often include empty repositioning miles.',
  })

  const railWalkMinutes = clamp(5, 18, 22 - averageTAccess * 3.1)
  const transferPenalty = sameLine ? 0 : 6
  const transitRouteMiles = directMiles * routeContext.transitDetour
  const transit = createMode({
    id: 't',
    label: 'The T',
    blurb: 'Rail-heavy transit estimate with station access and transfer time.',
    icon: ICONS.t,
    minutes:
      railWalkMinutes +
      departure.transitWait +
      transferPenalty +
      ((transitRouteMiles / 23) * 60) * routeContext.transitSpeedMultiplier,
    cost: 2.4,
    carbons: transitRouteMiles * CARBON_PER_MILE.transit,
    tags: sameLine ? origin.tLines.filter(line => destination.tLines.includes(line)).slice(0, 2) : uniqueTags([...origin.tLines, ...destination.tLines], 2),
    note: sameLine
      ? 'This trip likely stays on a connected rail corridor.'
      : 'This estimate adds a modest transfer penalty when your trip crosses lines.',
  })

  const busAccessMinutes = clamp(4, 16, 17 - averageBusAccess * 2.4)
  const busRouteMiles = directMiles * routeContext.busDetour
  const bus = createMode({
    id: 'bus',
    label: 'Bus',
    blurb: 'Broader coverage, usually slower but often inexpensive.',
    icon: ICONS.bus,
    minutes: busAccessMinutes + departure.busWait + (busRouteMiles / (10 / departure.busMultiplier)) * 60,
    cost: 1.7,
    carbons: busRouteMiles * CARBON_PER_MILE.bus,
    tags: uniqueTags([...origin.busLines, ...destination.busLines], 3),
    note: 'The bus estimate bakes in street traffic, so it can swing more than rail during rush periods.',
  })

  const walkingRouteMiles = directMiles * routeContext.walkDetour
  const walking = createMode({
    id: 'walking',
    label: 'Walking',
    blurb: walkingRouteMiles > 4.5 ? 'Zero-carbon, but this one is a serious walk.' : 'Simple, cheap, and about as low-carbon as it gets.',
    icon: ICONS.walking,
    minutes: routeContext.walkingBufferMinutes + (walkingRouteMiles / 3) * 60,
    cost: 0,
    carbons: walkingRouteMiles * CARBON_PER_MILE.walking,
    tags: [walkingRouteMiles > 4.5 ? 'long walk' : 'street-level trip'],
    note: 'Walking is treated as near-zero operational carbon and works best for nearby neighborhoods.',
  })

  const bikingRouteMiles = directMiles * routeContext.bikeDetour
  const bikingSpeed = 8.6 + (averageBikeAccess - 3) * 0.7
  const bikeStressPenalty = Math.max(0, 4 - averageBikeAccess) * 2.5 + Math.max(0, bikingRouteMiles - 3.5) * 2.2
  const biking = createMode({
    id: 'biking',
    label: 'Biking',
    blurb: 'Fast for medium-length city trips when the street network cooperates.',
    icon: ICONS.biking,
    minutes: routeContext.bikeSetupMinutes + bikeStressPenalty + (bikingRouteMiles / bikingSpeed) * 60,
    cost: 0,
    carbons: bikingRouteMiles * CARBON_PER_MILE.biking,
    tags: [averageBikeAccess >= 4 ? 'bike-friendly corridor' : 'mixed bike comfort'],
    note: 'Personal bike estimates assume you can roll directly without dock time or unlock fees.',
  })

  const bluebikes = estimateBluebikesMode({
    origin,
    destination,
    routeContext,
    averageBikeAccess,
    stations: bluebikeStations?.length ? bluebikeStations : fallbackBluebikeStations,
    useLiveAvailability: bluebikeLiveData,
  })

  const baseModes = [driving, rideshare, transit, bus, walking, biking, bluebikes]
  const results = baseModes
    .map(result => ({ ...result, score: scoreMode(result, baseModes, priority.id) }))
    .sort((left, right) => right.score - left.score)

  const recommended = results[0]
  const fastest = lowestBy(results, item => item.minutes)
  const cheapest = lowestBy(results, item => item.cost)
  const cleanest = lowestBy(results, item => item.carbons)

  return {
    distanceMiles: roundTo(directMiles, 1),
    results,
    recommended,
    fastest,
    cheapest,
    cleanest,
    driving,
    summary: buildSummary({ recommended, fastest, cheapest, cleanest, priority, destination }),
  }
}

function buildSummary({ recommended, fastest, cheapest, cleanest, priority, destination }) {
  if (priority.id === 'fastest') {
    return `${recommended.label} wins on raw travel time for this trip into ${destination.name}, landing at about ${formatMinutes(recommended.minutes)}.`
  }

  if (priority.id === 'cheapest') {
    return `${recommended.label} is the budget move here at roughly ${formatCurrency(recommended.cost)}, with parking-heavy modes getting more expensive as your stay stretches out.`
  }

  if (priority.id === 'cleanest') {
    return `${recommended.label} keeps the carbon footprint lowest on this route at about ${formatCarbon(recommended.carbons)}.`
  }

  return `${recommended.label} gives you the best balance of time, cost, and emissions for this route. ${fastest.label} is the speed king, ${cheapest.label} is the money saver, and ${cleanest.label} wins on carbon.`
}

function estimateBluebikesMode({
  origin,
  destination,
  routeContext,
  averageBikeAccess,
  stations,
  useLiveAvailability,
}) {
  const accessWalkDetour = 1.12
  const rawOriginOptions = nearestStations(origin, stations, 12)
  const rawDestinationOptions = nearestStations(destination, stations, 12)
  const originOptions = useLiveAvailability
    ? rawOriginOptions.filter(station => station.isInstalled && station.isRenting && station.bikesAvailable > 0)
    : rawOriginOptions
  const destinationOptions = useLiveAvailability
    ? rawDestinationOptions.filter(station => station.isInstalled && station.isReturning && station.docksAvailable > 0)
    : rawDestinationOptions
  let bestPath = null

  if (!originOptions.length || !destinationOptions.length) {
    const tags = []

    if (!originOptions.length) {
      tags.push('no nearby bikes available')
    }

    if (!destinationOptions.length) {
      tags.push('no nearby open docks')
    }

    return createMode({
      id: 'bluebikes',
      label: 'Bluebikes',
      blurb: 'Live dock data says this trip is not practical right now.',
      icon: ICONS.bluebikes,
      minutes: 999,
      cost: 0,
      carbons: 0,
      tags,
      note: useLiveAvailability
        ? 'The live Bluebikes feed did not find a workable start and end dock pairing for this trip right now.'
        : 'No viable dock pairing was found in the fallback station set.',
    })
  }

  for (const startStation of originOptions) {
    for (const endStation of destinationOptions) {
      if (startStation.id === endStation.id) {
        continue
      }

      const accessWalkMiles = startStation.distanceMiles * accessWalkDetour
      const egressWalkMiles = endStation.distanceMiles * accessWalkDetour
      const dockToDockMiles = Math.max(
        haversineMiles(startStation.lat, startStation.lng, endStation.lat, endStation.lng) * routeContext.bikeDetour,
        0.18,
      )
      const bikeSpeed = 8.4 + Math.max(0, averageBikeAccess - 3) * 0.55
      const accessMinutes = (accessWalkMiles / 3) * 60
      const egressMinutes = (egressWalkMiles / 3) * 60
      const bikeMinutes = (dockToDockMiles / bikeSpeed) * 60
      const dockOpsMinutes = routeContext.bikeSetupMinutes + 4
      const walkFrictionPenalty =
        Math.max(0, accessWalkMiles - 0.22) * 14 + Math.max(0, egressWalkMiles - 0.22) * 14
      const score =
        accessMinutes +
        egressMinutes +
        bikeMinutes +
        dockOpsMinutes +
        walkFrictionPenalty

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
    return createMode({
      id: 'bluebikes',
      label: 'Bluebikes',
      blurb: 'Bike-share needs a start and end dock to be viable.',
      icon: ICONS.bluebikes,
      minutes: 999,
      cost: 9.99,
      carbons: 0,
      tags: ['no viable dock pair'],
      note: 'No realistic dock-to-dock pairing was available in the local station set.',
    })
  }

  const tripCost = bestPath.minutes <= 30 ? 2.95 : bestPath.minutes <= 60 ? 4.25 : 6.5
  const longWalkRisk = bestPath.accessWalkMiles > 0.45 || bestPath.egressWalkMiles > 0.45
  const bothEndsDocked = bestPath.accessWalkMiles <= 0.25 && bestPath.egressWalkMiles <= 0.25

  return createMode({
    id: 'bluebikes',
    label: 'Bluebikes',
    blurb: 'Dock-to-dock ride with walking legs on both ends.',
    icon: ICONS.bluebikes,
    minutes: bestPath.minutes,
    cost: tripCost,
    carbons: bestPath.dockToDockMiles * CARBON_PER_MILE.bluebikes,
    tags: [
      `walk ${formatMinutes(accessEgressMinutes(bestPath.accessWalkMiles))} to dock`,
      `bike ${bestPath.dockToDockMiles.toFixed(1)} mi`,
      `walk ${formatMinutes(accessEgressMinutes(bestPath.egressWalkMiles))} after docking`,
      useLiveAvailability
        ? `${bestPath.startStation.bikesAvailable} bikes, ${bestPath.endStation.docksAvailable} docks live`
        : 'using fallback dock dataset',
    ],
    note: `${bestPath.startStation.name} to ${bestPath.endStation.name}. ${bothEndsDocked ? 'Docks are close at both ends.' : longWalkRisk ? 'This route works, but the walking legs are a real part of the trip.' : 'The dock access is manageable on both ends.'}`,
  })
}

function getRouteContext(origin, destination) {
  const isEastBostonTrip =
    (origin.id === 'east-boston' && destination.id !== 'east-boston') ||
    (destination.id === 'east-boston' && origin.id !== 'east-boston')
  const charlesBankIds = ['cambridge', 'somerville']
  const isCharlesCrossing =
    charlesBankIds.includes(origin.id) !== charlesBankIds.includes(destination.id)

  if (isEastBostonTrip) {
    return {
      driveDetour: 1.3,
      transitDetour: 1.35,
      busDetour: 1.28,
      walkDetour: 1.9,
      bikeDetour: 1.72,
      bikeSetupMinutes: 7,
      walkingBufferMinutes: 5,
      transitSpeedMultiplier: 0.96,
    }
  }

  if (isCharlesCrossing) {
    return {
      driveDetour: 1.25,
      transitDetour: 1.28,
      busDetour: 1.22,
      walkDetour: 1.24,
      bikeDetour: 1.3,
      bikeSetupMinutes: 5,
      walkingBufferMinutes: 3,
      transitSpeedMultiplier: 0.98,
    }
  }

  return {
    driveDetour: 1.22,
    transitDetour: 1.26,
    busDetour: 1.16,
    walkDetour: 1.08,
    bikeDetour: 1.18,
    bikeSetupMinutes: 4,
    walkingBufferMinutes: 2,
    transitSpeedMultiplier: 1,
  }
}

function nearestStations(place, stations, limit) {
  return stations
    .map(station => ({
      ...station,
      distanceMiles: haversineMiles(place.lat, place.lng, station.lat, station.lng),
    }))
    .sort((left, right) => left.distanceMiles - right.distanceMiles)
    .slice(0, limit)
}

function scoreMode(mode, allModes, priorityId) {
  const timeScore = normalizeInverse(mode.minutes, allModes.map(item => item.minutes))
  const costScore = normalizeInverse(mode.cost, allModes.map(item => item.cost))
  const carbonScore = normalizeInverse(mode.carbons, allModes.map(item => item.carbons))

  if (priorityId === 'fastest') {
    return timeScore * 0.7 + costScore * 0.15 + carbonScore * 0.15
  }

  if (priorityId === 'cheapest') {
    return costScore * 0.7 + timeScore * 0.2 + carbonScore * 0.1
  }

  if (priorityId === 'cleanest') {
    return carbonScore * 0.7 + timeScore * 0.2 + costScore * 0.1
  }

  return timeScore * 0.38 + costScore * 0.25 + carbonScore * 0.37
}

function createMode({ id, label, blurb, icon, minutes, cost, carbons, tags, note }) {
  return {
    id,
    label,
    blurb,
    icon,
    minutes: roundTo(minutes, 0),
    cost: roundTo(cost, 2),
    carbons: roundTo(carbons, 0),
    tags,
    note,
  }
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

function normalizeInverse(value, values) {
  const min = Math.min(...values)
  const max = Math.max(...values)

  if (max === min) {
    return 1
  }

  return 1 - (value - min) / (max - min)
}

function lowestBy(items, accessor) {
  return items.reduce((best, candidate) => (accessor(candidate) < accessor(best) ? candidate : best), items[0])
}

function uniqueTags(values, limit) {
  return [...new Set(values)].slice(0, limit)
}

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value))
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function formatMinutes(minutes) {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = Math.round(minutes % 60)

  if (remainingMinutes === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${remainingMinutes} min`
}

function accessEgressMinutes(totalWalkMiles) {
  return (totalWalkMiles / 3) * 60
}

export function formatCurrency(amount) {
  if (amount === 0) {
    return '$0'
  }

  return `$${amount.toFixed(2)}`
}

export function formatCarbon(grams) {
  if (grams <= 0) {
    return 'near zero'
  }

  if (grams < 1000) {
    return `${Math.round(grams)} g CO2e`
  }

  return `${(grams / 1000).toFixed(2)} kg CO2e`
}
