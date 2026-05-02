import { useEffect, useMemo, useState } from 'react'
import {
  departureWindows,
  places,
  priorityPresets,
  stayDurations,
} from './data/places.js'
import { fetchPointToPointCommute } from './lib/commuteApi.js'
import {
  formatCarbon,
  formatCurrency,
  formatMinutes,
} from './lib/commute.js'
import styles from './App.module.css'

const defaultState = {
  originQuery: 'Maverick Square, Boston, MA',
  destinationQuery: 'Nubian Square, Boston, MA',
  departureId: 'morning',
  stayId: 'standard',
  priorityId: 'balanced',
}

const sampleTrips = [
  {
    id: 'east-to-roxbury',
    label: 'Maverick -> Nubian',
    originQuery: 'Maverick Square, Boston, MA',
    destinationQuery: 'Nubian Square, Boston, MA',
  },
  {
    id: 'bu-to-north-end',
    label: 'BU -> North End',
    originQuery: 'Boston University West Campus, Boston, MA',
    destinationQuery: 'North End, Boston, MA',
  },
  {
    id: 'harvard-to-seaport',
    label: 'Harvard -> Seaport',
    originQuery: 'Harvard Square, Cambridge, MA',
    destinationQuery: 'Seaport Boulevard, Boston, MA',
  },
]

export default function App() {
  const [answers, setAnswers] = useState(defaultState)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [trip, setTrip] = useState(null)

  const selectedDeparture = useMemo(
    () => departureWindows.find(item => item.id === answers.departureId) || departureWindows[0],
    [answers.departureId],
  )
  const selectedPriority = useMemo(
    () => priorityPresets.find(item => item.id === answers.priorityId) || priorityPresets[0],
    [answers.priorityId],
  )

  useEffect(() => {
    handleCompare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCompare(event) {
    event?.preventDefault()
    setStatus('loading')
    setError('')

    try {
      const payload = await fetchPointToPointCommute(answers)
      setTrip(payload)
      setStatus('ready')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load the live commute comparison.',
      )
      setStatus('error')
    }
  }

  function updateAnswer(key, value) {
    setAnswers(current => ({ ...current, [key]: value }))
  }

  function swapTrip() {
    setAnswers(current => ({
      ...current,
      originQuery: current.destinationQuery,
      destinationQuery: current.originQuery,
    }))
  }

  function applySampleTrip(sample) {
    setAnswers(current => ({
      ...current,
      originQuery: sample.originQuery,
      destinationQuery: sample.destinationQuery,
    }))
  }

  const carbonDelta =
    trip?.driving && trip?.recommended
      ? trip.driving.carbons - trip.recommended.carbons
      : null
  const costDelta =
    trip?.driving && trip?.recommended
      ? Math.abs(trip.recommended.cost - trip.driving.cost)
      : null
  const timeDelta =
    trip?.driving && trip?.recommended
      ? Math.abs(trip.recommended.minutes - trip.driving.minutes)
      : null

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Point-to-point routing with server-side API keys</p>
          <h1>Live Boston commute routing, not just presets.</h1>
          <p className={styles.heroText}>
            This branch geocodes two freeform inputs, calls Google Maps Platform on the server for live routes,
            and combines that with live Bluebikes dock availability for a real point-to-point
            comparison.
          </p>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.stepLabel}>API Input</p>
              <h2>Route origin to destination</h2>
            </div>
            <button type="button" className={styles.swapButton} onClick={swapTrip}>
              Swap trip
            </button>
          </div>

          <form onSubmit={handleCompare}>
            <div className={styles.formGrid}>
              <TextQuestion
                label="Where are you starting?"
                value={answers.originQuery}
                onChange={value => updateAnswer('originQuery', value)}
              />
              <TextQuestion
                label="Where are you going?"
                value={answers.destinationQuery}
                onChange={value => updateAnswer('destinationQuery', value)}
              />
            </div>

            <datalist id="place-hints">
              {places.map(place => (
                <option key={place.id} value={place.name} />
              ))}
            </datalist>

            <div className={styles.sampleRow}>
              {sampleTrips.map(sample => (
                <button
                  key={sample.id}
                  type="button"
                  className={styles.sampleButton}
                  onClick={() => applySampleTrip(sample)}
                >
                  {sample.label}
                </button>
              ))}
            </div>

            <ChipSection
              label="When are you leaving?"
              value={answers.departureId}
              options={departureWindows}
              onChange={value => updateAnswer('departureId', value)}
            />

            <ChipSection
              label="How long are you staying?"
              value={answers.stayId}
              options={stayDurations}
              onChange={value => updateAnswer('stayId', value)}
            />

            <ChipSection
              label="What matters most?"
              value={answers.priorityId}
              options={priorityPresets}
              onChange={value => updateAnswer('priorityId', value)}
            />

            <div className={styles.buttonRow}>
              <button className={styles.primaryButton} type="submit" disabled={status === 'loading'}>
                {status === 'loading' ? 'Routing live trip...' : 'Compare live routes'}
              </button>
            </div>
          </form>

          <div className={`${styles.apiBanner} ${trip ? styles.apiBannerLive : styles.apiBannerFallback}`}>
            <div>
              <p className={styles.apiBannerTitle}>
                {trip ? 'Point-to-point API is active' : 'Point-to-point API needs a key'}
              </p>
              <p className={styles.apiBannerText}>
                {trip
                  ? `Live routing is using Google Maps Platform for ${selectedDeparture.label.toLowerCase()} departure timing and Bluebikes for current dock availability.`
                  : 'If the form errors, the usual cause is a missing GOOGLE_MAPS_API_KEY or an address that Google could not geocode cleanly.'}
              </p>
            </div>
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}
        </section>

        {trip && (
          <>
            <section className={styles.recommendation}>
              <div className={styles.recommendationTop}>
                <div>
                  <p className={styles.stepLabel}>Recommendation</p>
                  <h2>{trip.recommended.label} is the best fit right now</h2>
                </div>
                <span className={styles.priorityBadge}>{selectedPriority.label}</span>
              </div>

              <p className={styles.recommendationText}>{trip.summary}</p>

              <div className={styles.summaryGrid}>
                <SummaryMetric label="Origin" value={trip.origin.label} />
                <SummaryMetric label="Destination" value={trip.destination.label} />
                <SummaryMetric
                  label="Fastest"
                  value={trip.fastest.label}
                  subvalue={formatMinutes(trip.fastest.minutes)}
                />
                <SummaryMetric
                  label="Lowest carbon"
                  value={trip.cleanest.label}
                  subvalue={formatCarbon(trip.cleanest.carbons)}
                />
              </div>

              {trip.driving && carbonDelta !== null && costDelta !== null && timeDelta !== null && (
                <div className={styles.deltaCard}>
                  <p className={styles.deltaEyebrow}>Compared with driving</p>
                  <p className={styles.deltaValue}>
                    {trip.recommended.id === 'driving'
                      ? 'Driving wins this one on your selected priority.'
                      : `${formatCarbon(Math.abs(carbonDelta))} ${carbonDelta >= 0 ? 'less' : 'more'} carbon`}
                  </p>
                  <p className={styles.deltaText}>
                    {trip.recommended.id === 'driving'
                      ? 'The live route still shows what you are paying in parking and emissions.'
                      : `${trip.recommended.label} is ${formatMinutes(timeDelta)} ${trip.recommended.minutes <= trip.driving.minutes ? 'faster' : 'slower'} and costs ${formatCurrency(costDelta)} ${trip.recommended.cost <= trip.driving.cost ? 'less' : 'more'}.`}
                  </p>
                </div>
              )}

              {trip.metadata?.liveBluebikes && (
                <div className={styles.ejNote}>
                  <p className={styles.ejLabel}>Live feed status</p>
                  <p>
                    Bluebikes is using the live GBFS feed here, so the dock pair search is checking
                    current bikes and open docks rather than only a static station list.
                  </p>
                </div>
              )}
            </section>

            <section className={styles.resultsSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.stepLabel}>Mode Breakdown</p>
                  <h2>Compare every point-to-point option</h2>
                </div>
              </div>

              <div className={styles.resultsGrid}>
                {trip.results.map(result => (
                  <article
                    key={result.id}
                    className={`${styles.modeCard} ${result.id === trip.recommended.id ? styles.modeCardFeatured : ''} ${!result.available ? styles.modeCardUnavailable : ''}`}
                  >
                    <div className={styles.modeTop}>
                      <div>
                        <div className={styles.modeTitleRow}>
                          <span className={styles.modeIcon}>{result.icon}</span>
                          <h3>{result.label}</h3>
                        </div>
                        <p className={styles.modeBlurb}>{result.blurb}</p>
                      </div>
                      {result.id === trip.recommended.id && result.available && <span className={styles.winnerBadge}>Top pick</span>}
                    </div>

                    {result.available ? (
                      <>
                        <div className={styles.metricList}>
                          <ModeMetric label="Travel time" value={formatMinutes(result.minutes)} />
                          <ModeMetric label="Trip cost" value={formatCurrency(result.cost)} />
                          <ModeMetric label="Carbon" value={formatCarbon(result.carbons)} />
                        </div>

                        {!!result.tags.length && (
                          <div className={styles.tagRow}>
                            {result.tags.map(tag => (
                              <span key={`${result.id}-${tag}`} className={styles.tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className={styles.metricList}>
                        <ModeMetric label="Status" value="Unavailable" />
                      </div>
                    )}

                    <p className={styles.modeNote}>{result.note}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.assumptions}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.stepLabel}>Integration Map</p>
                  <h2>How the API-key flow is wired</h2>
                </div>
              </div>

              <div className={styles.assumptionGrid}>
                <InfoCard
                  title="1. Client -> /api/commute"
                  body="The React app posts the origin, destination, departure preset, and stay length to a same-origin endpoint. No Google API key is exposed in the browser."
                />
                <InfoCard
                  title="2. /api/commute -> Google"
                  body="The server geocodes both points with Google Geocoding and requests live driving, walking, bicycling, rail-transit, and bus-transit routes from Google Directions."
                />
                <InfoCard
                  title="3. Bluebikes layer"
                  body="The server also loads the official Bluebikes feed, finds nearby origin and destination docks, and scores dock-to-dock routes with walk-bike-walk legs."
                />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function TextQuestion({ label, value, onChange }) {
  return (
    <label className={styles.question}>
      <span className={styles.questionLabel}>{label}</span>
      <input
        className={styles.textInput}
        list="place-hints"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Type any Boston address, station, or neighborhood"
      />
    </label>
  )
}

function ChipSection({ label, value, options, onChange }) {
  return (
    <div className={styles.questionBlock}>
      <p className={styles.questionLabel}>{label}</p>
      <div className={styles.chipRow}>
        {options.map(option => (
          <button
            key={option.id}
            type="button"
            className={`${styles.chip} ${value === option.id ? styles.chipActive : ''}`}
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
          >
            <span>{option.label}</span>
            {option.hint && <small>{option.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  )
}

function SummaryMetric({ label, value, subvalue }) {
  return (
    <div className={styles.summaryMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subvalue && <small>{subvalue}</small>}
    </div>
  )
}

function ModeMetric({ label, value }) {
  return (
    <div className={styles.modeMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InfoCard({ title, body }) {
  return (
    <article className={styles.infoCard}>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  )
}
