import { CronExpressionParser } from 'cron-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ScheduleJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string | null
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

export interface CoverageWindow {
  start: string
  end: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/i

function parseRate(expr: string): { ms: number } | null {
  const m = expr.trim().match(RATE_RE)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  let factor: number
  if (unit.startsWith('minute')) factor = 60_000
  else if (unit.startsWith('hour')) factor = 3_600_000
  else factor = 86_400_000
  return { ms: n * factor }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function isoMinute(d: Date): string {
  // Truncate to the minute, ISO UTC.
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString()
}

// Offset (in minutes) of a given UTC instant in a given IANA timezone.
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === '24' ? '0' : map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return (asUtc - instant.getTime()) / 60_000
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || typeof expr !== 'string' || expr.trim().length === 0) {
    return { valid: false, error: 'Expression is empty' }
  }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    return parseRate(expr)
      ? { valid: true }
      : { valid: false, error: 'Rate must look like "every N minutes|hours|days"' }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    return Number.isNaN(t)
      ? { valid: false, error: 'One-off must be a parseable ISO timestamp' }
      : { valid: true }
  }
  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid expression: ${v.error}`
  if (kind === 'rate') {
    const r = parseRate(expr)!
    const mins = r.ms / 60_000
    if (mins % 1440 === 0) return `Every ${mins / 1440} day(s) (${timezone})`
    if (mins % 60 === 0) return `Every ${mins / 60} hour(s) (${timezone})`
    return `Every ${mins} minute(s) (${timezone})`
  }
  if (kind === 'oneoff') {
    return `Once at ${new Date(expr).toISOString()} (${timezone})`
  }
  // cron
  const fields = expr.trim().split(/\s+/)
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') parts.push('every minute')
  else if (hour === '*') parts.push(`at minute ${min} of every hour`)
  else if (min !== '*' && hour !== '*') parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else parts.push(`minute=${min} hour=${hour}`)
  if (dom && dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon && mon !== '*') parts.push(`in month ${mon}`)
  if (dow && dow !== '*') parts.push(`on weekday ${dow}`)
  return `Runs ${parts.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 5,
): string[] {
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []

  if (kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        out.push(it.next().toDate().toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime()
    for (let i = 0; i < n; i++) {
      t += r.ms
      out.push(new Date(t).toISOString())
    }
    return out
  }

  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return []
    if (t > from.getTime()) return [new Date(t).toISOString()]
    return []
  }

  return []
}

// ---------------------------------------------------------------------------
// firingsWithin — internal helper used by collisions/heatmap/coverage
// ---------------------------------------------------------------------------

function firingsWithin(job: ScheduleJob, fromISO: string, horizonDays: number, cap = 5000): string[] {
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime())) return []
  const endMs = from.getTime() + horizonDays * 86_400_000
  const tz = job.timezone ?? 'UTC'
  const out: string[] = []

  if (job.kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(job.expr, { tz, currentDate: from })
      while (out.length < cap) {
        const next = it.next().toDate()
        if (next.getTime() > endMs) break
        out.push(next.toISOString())
      }
    } catch {
      return []
    }
    return out
  }

  if (job.kind === 'rate') {
    const r = parseRate(job.expr)
    if (!r) return []
    let t = from.getTime()
    while (out.length < cap) {
      t += r.ms
      if (t > endMs) break
      out.push(new Date(t).toISOString())
    }
    return out
  }

  if (job.kind === 'oneoff') {
    const t = Date.parse(job.expr)
    if (Number.isNaN(t)) return []
    if (t >= from.getTime() && t <= endMs) return [new Date(t).toISOString()]
    return []
  }

  return []
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: ScheduleJob[],
  opts: { horizonDays?: number; threshold?: number; fromISO?: string } = {},
): Collision[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 2
  const fromISO = opts.fromISO ?? new Date().toISOString()

  // Bucket firings by minute.
  const byMinute = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()
  for (const job of jobs) {
    const firings = firingsWithin(job, fromISO, horizonDays)
    for (const f of firings) {
      const minute = isoMinute(new Date(f))
      let entry = byMinute.get(minute)
      if (!entry) {
        entry = { jobIds: new Set(), resources: new Map() }
        byMinute.set(minute, entry)
      }
      entry.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = entry.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          entry.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const collisions: Collision[] = []
  for (const [minute, entry] of byMinute) {
    const concurrency = entry.jobIds.size
    // Resource contention: a single resource hit by >= 2 jobs in the same minute.
    let resourceConflict: string | undefined
    for (const [resourceId, rs] of entry.resources) {
      if (rs.size >= 2) {
        resourceConflict = resourceId
        break
      }
    }
    const flagged = concurrency >= threshold || resourceConflict !== undefined
    if (!flagged) continue

    const windowStart = minute
    const windowEnd = new Date(new Date(minute).getTime() + 60_000).toISOString()
    let severity: Collision['severity'] = 'low'
    if (resourceConflict || concurrency >= threshold + 2) severity = 'high'
    else if (concurrency >= threshold + 1) severity = 'medium'

    const collision: Collision = {
      windowStart,
      windowEnd,
      jobIds: [...entry.jobIds].sort(),
      severity,
    }
    if (resourceConflict) collision.resourceId = resourceConflict
    collisions.push(collision)
  }

  collisions.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return collisions
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: ScheduleJob[],
  opts: { horizonDays?: number; fromISO?: string } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = opts.fromISO ?? new Date().toISOString()

  const counts = new Map<string, number>()
  for (const job of jobs) {
    for (const f of firingsWithin(job, fromISO, horizonDays)) {
      // Bucket by hour.
      const d = new Date(f)
      const bucket = new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000).toISOString()
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string,
  fromISO: string,
  days: number,
): DstTrap[] {
  if (!isValidTimezone(timezone)) return []
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime())) return []

  const traps: DstTrap[] = []
  const stepMs = 3_600_000 // hourly probe
  const endMs = from.getTime() + days * 86_400_000

  let prev = from.getTime()
  let prevOffset = tzOffsetMinutes(new Date(prev), timezone)

  for (let t = from.getTime() + stepMs; t <= endMs; t += stepMs) {
    const offset = tzOffsetMinutes(new Date(t), timezone)
    if (offset !== prevOffset) {
      const transitionUtc = new Date(t)
      const localDtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      const atLocal = localDtf.format(transitionUtc).replace(', ', 'T')
      if (offset > prevOffset) {
        // Clocks moved forward (spring): a local hour is skipped.
        traps.push({ type: 'skip', atLocal, atUtc: transitionUtc.toISOString() })
        // A schedule landing in the skipped local window can double-fire on some engines.
        traps.push({ type: 'double_fire', atLocal, atUtc: transitionUtc.toISOString() })
      } else {
        // Clocks moved back (fall): a local hour repeats → ambiguous local times.
        traps.push({ type: 'ambiguous', atLocal, atUtc: transitionUtc.toISOString() })
      }
    }
    prevOffset = offset
    prev = t
  }

  // If the schedule never fires near a transition, still return detected transitions;
  // the firing-correlation refinement: keep only transitions that intersect firings.
  if (kind && expr) {
    const firings = nextFirings(kind, expr, timezone, fromISO, 500)
    if (firings.length > 0) {
      const firingHours = new Set(
        firings.map((f) => new Date(Math.floor(new Date(f).getTime() / 3_600_000) * 3_600_000).toISOString()),
      )
      return traps.filter((tr) => {
        const hr = new Date(Math.floor(new Date(tr.atUtc).getTime() / 3_600_000) * 3_600_000).toISOString()
        // Keep traps within +/- 1 hour of a firing.
        const before = new Date(new Date(hr).getTime() - 3_600_000).toISOString()
        const after = new Date(new Date(hr).getTime() + 3_600_000).toISOString()
        return firingHours.has(hr) || firingHours.has(before) || firingHours.has(after)
      })
    }
  }

  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: ScheduleJob[],
  opts: { horizonDays?: number; fromISO?: string } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = opts.fromISO ?? new Date().toISOString()

  // Collect all firing instants across all jobs, sorted.
  const firings: number[] = []
  for (const job of jobs) {
    for (const f of firingsWithin(job, fromISO, horizonDays)) {
      firings.push(new Date(f).getTime())
    }
  }
  firings.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const ws = Date.parse(w.start)
    const we = Date.parse(w.end)
    if (Number.isNaN(ws) || Number.isNaN(we) || we <= ws) continue

    const inWindow = firings.filter((t) => t >= ws && t <= we)
    if (inWindow.length === 0) {
      gaps.push({
        windowStart: new Date(ws).toISOString(),
        windowEnd: new Date(we).toISOString(),
        durationMinutes: Math.round((we - ws) / 60_000),
      })
      continue
    }
    // Gap before first firing.
    let cursor = ws
    for (const t of inWindow) {
      if (t - cursor > 60_000) {
        gaps.push({
          windowStart: new Date(cursor).toISOString(),
          windowEnd: new Date(t).toISOString(),
          durationMinutes: Math.round((t - cursor) / 60_000),
        })
      }
      cursor = t
    }
    // Gap after last firing.
    if (we - cursor > 60_000) {
      gaps.push({
        windowStart: new Date(cursor).toISOString(),
        windowEnd: new Date(we).toISOString(),
        durationMinutes: Math.round((we - cursor) / 60_000),
      })
    }
  }

  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: ScheduleJob[],
  opts: { threshold?: number; horizonDays?: number; fromISO?: string } = {},
): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 2
  const collisions = computeCollisions(jobs, {
    threshold,
    horizonDays: opts.horizonDays,
    fromISO: opts.fromISO,
  })

  // For each colliding minute, keep the first job, suggest staggering the rest.
  const suggestions = new Map<string, SpreadSuggestion>()
  for (const col of collisions) {
    const ids = col.jobIds
    for (let i = 1; i < ids.length; i++) {
      const jobId = ids[i]
      if (suggestions.has(jobId)) continue
      const job = jobs.find((j) => j.id === jobId)
      if (!job) continue
      const offsetMin = i * 5 // stagger by 5 minutes per index
      suggestions.set(jobId, {
        jobId,
        suggestedExpr: staggerExpr(job, offsetMin),
        reason: `Collides with ${ids.length} jobs at ${col.windowStart}; stagger by ${offsetMin} minute(s)`,
      })
    }
  }

  return [...suggestions.values()]
}

function staggerExpr(job: ScheduleJob, offsetMin: number): string {
  if (job.kind === 'cron') {
    const fields = job.expr.trim().split(/\s+/)
    if (fields.length >= 1) {
      const minField = fields[0]
      const base = /^\d+$/.test(minField) ? parseInt(minField, 10) : 0
      fields[0] = String((base + offsetMin) % 60)
      return fields.join(' ')
    }
    return job.expr
  }
  if (job.kind === 'rate') {
    // Rates cannot encode a phase offset; annotate the suggestion.
    return `${job.expr} (offset +${offsetMin}m)`
  }
  if (job.kind === 'oneoff') {
    const t = Date.parse(job.expr)
    if (Number.isNaN(t)) return job.expr
    return new Date(t + offsetMin * 60_000).toISOString()
  }
  return job.expr
}
