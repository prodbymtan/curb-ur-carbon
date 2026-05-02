import { useEffect, useMemo, useState } from 'react'
import {
  departureWindows,
  places,
  priorityPresets,
  stayDurations,
} from './data/places.js'
import {
  estimateCommute,
  formatCarbon,
  formatCurrency,
  formatMinutes,
} from './lib/commute.js'
import { fetchBluebikesFromAppApi } from './lib/bluebikesApi.js'
import styles from './App.module.css'

const defaultState = {
  originId: 'east-boston',
  destinationId: 'roxbury',
  departureId: 'morning',
  stayId: 'standard',
  priorityId: 'balanced',
}

export default function App() {
  const [answers, setAnswers] = useState(defaultState)
  const [bluebikesApi, setBluebikesApi] = useState({
    status: 'loading',
    stations: null,
    lastUpdated: null,
    error: '',
  })

  const origin = places.find(place => place.id === answers.originId) || places[0]
  const destination = places.find(place => place.id === answers.destinationId) || places[1]
  const departure = departureWindows.find(window => window.id === answers.departureId) || departureWindows[0]
  const stay = stayDurations.find(option => option.id === answers.stayId) || stayDurations[1]
  const priority = priorityPresets.find(option => option.id === answers.priorityId) || priorityPresets[0]

  useEffect(() => {
    let cancelled = false

    async function loadBluebikes() {
      try {
        const payload = await fetchBluebikesFromAppApi()
        if (cancelled) {
          return
        }

        setBluebikesApi({
          status: 'live',
          stations: payload.stations || null,
          lastUpdated: payload.lastUpdated || null,
          error: '',
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        setBluebikesApi({
          status: 'fallback',
          stations: null,
          lastUpdated: null,
          error: error instanceof Error ? error.message : 'Could not load live Bluebikes data.',
        })
      }
    }

    loadBluebikes()

    return () => {
      cancelled = true
    }
  }, [])

  const commute = useMemo(
    () =>
      estimateCommute({
        origin,
        destination,
        departure,
        stay,
        priority,
        bluebikeStations: bluebikesApi.stations,
        bluebikeLiveData: bluebikesApi.status === 'live',
      }),
    [origin, destination, departure, stay, priority, bluebikesApi.stations, bluebikesApi.status],
  )
  const carbonDelta = commute.driving.carbons - commute.recommended.carbons
  const costDelta = Math.abs(commute.recommended.cost - commute.driving.cost)
  const timeDelta = Math.abs(commute.recommended.minutes - commute.driving.minutes)

  function updateAnswer(key, value) {
    setAnswers(current => ({ ...current, [key]: value }))
  }

  function swapTrip() {
    setAnswers(current => ({
      ...current,
      originId: current.destinationId,
      destinationId: current.originId,
    }))
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Built from scratch, now with live Bluebikes data</p>
          <h1>Boston commute choices, minus the broken maps setup.</h1>
          <p className={styles.heroText}>
            Pick a start, pick a destination, and this app will estimate time, cost, and
            carbon across driving, rideshare, the T, bus, walking, biking, and Bluebikes.
          </p>
        </div>

        <div className={styles.heroStats}>
          <QuickStat label="Modes compared" value="7" />
          <QuickStat label="Boston spots" value={String(places.length)} />
          <QuickStat label="Setup required" value="0 API keys" />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.stepLabel}>Questionnaire</p>
              <h2>Set up your trip</h2>
            </div>
            <button type="button" className={styles.swapButton} onClick={swapTrip}>
              Swap trip
            </button>
          </div>

          <div className={styles.formGrid}>
            <SelectQuestion
              label="Where are you starting?"
              value={answers.originId}
              options={places}
              onChange={value => updateAnswer('originId', value)}
            />
            <SelectQuestion
              label="Where are you going?"
              value={answers.destinationId}
              options={places}
              onChange={value => updateAnswer('destinationId', value)}
            />
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

          <p className={styles.helperText}>
            This version uses live Bluebikes station availability when the feed is up, then falls
            back to local Boston commute assumptions for the rest of the comparison engine.
          </p>

          <div className={`${styles.apiBanner} ${bluebikesApi.status === 'live' ? styles.apiBannerLive : styles.apiBannerFallback}`}>
            <div>
              <p className={styles.apiBannerTitle}>
                {bluebikesApi.status === 'live'
                  ? 'Live Bluebikes API connected'
                  : bluebikesApi.status === 'loading'
                    ? 'Loading Bluebikes API'
                    : 'Using fallback Bluebikes data'}
              </p>
              <p className={styles.apiBannerText}>
                {bluebikesApi.status === 'live'
                  ? `Dock pairing now uses current bikes and open docks from the official Bluebikes feed${bluebikesApi.lastUpdated ? `, updated ${formatFeedTime(bluebikesApi.lastUpdated)}` : ''}.`
                  : bluebikesApi.status === 'loading'
                    ? 'Checking the live Bluebikes feed now.'
                    : `The live feed was unavailable, so Bluebikes falls back to the local station dataset. ${bluebikesApi.error}`}
              </p>
            </div>
          </div>
        </section>

        <section className={styles.recommendation}>
          <div className={styles.recommendationTop}>
            <div>
              <p className={styles.stepLabel}>Recommendation</p>
              <h2>{commute.recommended.label} is the best fit right now</h2>
            </div>
            <span className={styles.priorityBadge}>{priority.label}</span>
          </div>

          <p className={styles.recommendationText}>{commute.summary}</p>

          <div className={styles.summaryGrid}>
            <SummaryMetric label="Trip distance" value={`${commute.distanceMiles.toFixed(1)} mi`} />
            <SummaryMetric label="Fastest" value={commute.fastest.label} subvalue={formatMinutes(commute.fastest.minutes)} />
            <SummaryMetric label="Cheapest" value={commute.cheapest.label} subvalue={formatCurrency(commute.cheapest.cost)} />
            <SummaryMetric label="Lowest carbon" value={commute.cleanest.label} subvalue={formatCarbon(commute.cleanest.carbons)} />
          </div>

          <div className={styles.deltaCard}>
            <p className={styles.deltaEyebrow}>Compared with driving</p>
            <p className={styles.deltaValue}>
              {commute.recommended.id === 'driving'
                ? 'Driving wins this one on your selected priority.'
                : `${formatCarbon(Math.abs(carbonDelta))} ${carbonDelta >= 0 ? 'less' : 'more'} carbon`}
            </p>
            <p className={styles.deltaText}>
              {commute.recommended.id === 'driving'
                ? 'The model still shows what you are paying in parking time and tailpipe emissions.'
                : `${commute.recommended.label} is ${formatMinutes(timeDelta)} ${commute.recommended.minutes <= commute.driving.minutes ? 'faster' : 'slower'} and costs ${formatCurrency(costDelta)} ${commute.recommended.cost <= commute.driving.cost ? 'less' : 'more'}.`}
            </p>
          </div>

          {destination.ejCommunity && (
            <div className={styles.ejNote}>
              <p className={styles.ejLabel}>Air quality context</p>
              <p>
                {destination.name} is marked here as an environmental justice community. Extra car
                trips and parking hunts do not just cost time; they also stack more pollution into
                streets where health burdens are already uneven.
              </p>
            </div>
          )}
        </section>

        <section className={styles.resultsSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.stepLabel}>Mode Breakdown</p>
              <h2>Compare every option</h2>
            </div>
          </div>

          <div className={styles.resultsGrid}>
            {commute.results.map(result => (
              <article
                key={result.id}
                className={`${styles.modeCard} ${result.id === commute.recommended.id ? styles.modeCardFeatured : ''}`}
              >
                <div className={styles.modeTop}>
                  <div>
                    <div className={styles.modeTitleRow}>
                      <span className={styles.modeIcon}>{result.icon}</span>
                      <h3>{result.label}</h3>
                    </div>
                    <p className={styles.modeBlurb}>{result.blurb}</p>
                  </div>
                  {result.id === commute.recommended.id && <span className={styles.winnerBadge}>Top pick</span>}
                </div>

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

                <p className={styles.modeNote}>{result.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.assumptions}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.stepLabel}>How It Works</p>
              <h2>Simple, transparent assumptions</h2>
            </div>
          </div>

          <div className={styles.assumptionGrid}>
            <InfoCard
              title="Travel time"
              body="Estimated from neighborhood-to-neighborhood distance plus time-of-day traffic, wait time, parking hunt, transfer, and station-access multipliers. Bluebikes now searches dock pairs and includes the walking legs before and after the ride."
            />
            <InfoCard
              title="Carbon"
              body="Driving uses an EPA-style passenger car baseline. Rideshare is modeled higher to reflect empty miles. Walking and personal biking are treated as near-zero operational emissions."
            />
            <InfoCard
              title="Costs"
              body="Driving blends fuel and destination parking. Transit uses simple fare assumptions. Bluebikes and rideshare use rough trip-cost estimates meant for comparison, not billing."
            />
          </div>
        </section>
      </main>
    </div>
  )
}

function formatFeedTime(unixSeconds) {
  const timestamp = Number(unixSeconds)
  if (!Number.isFinite(timestamp)) {
    return 'recently'
  }

  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function SelectQuestion({ label, value, options, onChange }) {
  return (
    <label className={styles.question}>
      <span className={styles.questionLabel}>{label}</span>
      <select className={styles.select} value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
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

function QuickStat({ label, value }) {
  return (
    <div className={styles.quickStat}>
      <strong>{value}</strong>
      <span>{label}</span>
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
