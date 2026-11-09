import {DAY, RETENTION_DAYS, mountainDate, mountainMidnight, shiftDate} from './reporting-range.mjs';

export const DAILY_HISTORY_DAYS = 366;
const devices = ['all', 'phone', 'tablet', 'desktop', 'unknown'];

export function storeDailyHistory(db, clock = Date.now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_history_start (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_daily_totals (
      date TEXT NOT NULL,
      device TEXT NOT NULL,
      visitors INTEGER NOT NULL,
      sessions INTEGER NOT NULL,
      pageViews INTEGER NOT NULL,
      productClicks INTEGER NOT NULL,
      productViews INTEGER NOT NULL,
      addToBag INTEGER NOT NULL,
      checkoutStarts INTEGER NOT NULL,
      seconds INTEGER NOT NULL,
      PRIMARY KEY(date,device)
    );
  `);
  const first = db.prepare('SELECT at FROM store_history_start WHERE singleton=1');
  const saveStart = db.prepare(`
    INSERT INTO store_history_start VALUES(1,?)
    ON CONFLICT(singleton) DO UPDATE SET at=excluded.at
    WHERE excluded.at < store_history_start.at
  `);
  const retainedFirst = db.prepare("SELECT min(at) AS at FROM store_events WHERE type='page_view'").get().at;
  if (retainedFirst !== null) saveStart.run(retainedFirst);
  const latest = db.prepare("SELECT max(date) AS date FROM store_daily_totals WHERE device='all'");
  const oldest = db.prepare("SELECT min(date) AS date FROM store_daily_totals WHERE device='all'");
  const collect = db.prepare(`
    SELECT
      count(DISTINCT CASE WHEN type='page_view' THEN visitor END) AS visitors,
      count(DISTINCT CASE WHEN type='page_view' THEN session END) AS sessions,
      count(CASE WHEN type='page_view' THEN 1 END) AS pageViews,
      count(CASE WHEN type='product_click' THEN 1 END) AS productClicks,
      count(CASE WHEN type='product_view' THEN 1 END) AS productViews,
      count(CASE WHEN type='add_to_bag' THEN 1 END) AS addToBag,
      count(CASE WHEN type='checkout_start' THEN 1 END) AS checkoutStarts,
      coalesce(sum(CASE WHEN type='page_time' THEN seconds ELSE 0 END),0) AS seconds
    FROM store_events
    WHERE at>=? AND at<? AND (?='all' OR device=?)
  `);
  const save = db.prepare('INSERT OR IGNORE INTO store_daily_totals VALUES(?,?,?,?,?,?,?,?,?,?)');
  const prune = db.prepare('DELETE FROM store_daily_totals WHERE date<?');
  const read = db.prepare('SELECT * FROM store_daily_totals WHERE device=? AND date>=? AND date<=? ORDER BY date');
  let sealedThrough;
  function seal(now = clock()) {
    const today = mountainDate(now);
    if (today === sealedThrough) return;
    const firstAt = first.get()?.at;
    if (firstAt === undefined) return;
    const previous = latest.get().date;
    // The retention cutoff can bisect a calendar day. Only backfill days
    // for which the entire raw window was still eligible to be retained.
    const cutoff = now - RETENTION_DAYS * DAY;
    const cutoffDate = mountainDate(cutoff);
    const firstFullDate = mountainMidnight(cutoffDate) < cutoff ? shiftDate(cutoffDate, 1) : cutoffDate;
    const from = [mountainDate(firstAt), firstFullDate, previous ? shiftDate(previous, 1) : ''].sort().at(-1);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let date = from; date < today; date = shiftDate(date, 1)) {
        const start = mountainMidnight(date);
        const end = mountainMidnight(shiftDate(date, 1));
        for (const device of devices) {
          const row = collect.get(start, end, device, device);
          save.run(date, device, row.visitors, row.sessions, row.pageViews,
            row.productClicks, row.productViews, row.addToBag, row.checkoutStarts, row.seconds);
        }
      }
      prune.run(shiftDate(today, -DAILY_HISTORY_DAYS));
      db.exec('COMMIT');
      sealedThrough = today;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function coverage(range, device, now) {
    const firstAt = first.get()?.at;
    const cutoff = now - RETENTION_DAYS * DAY;
    const archived = read.all(device, range.startDate, range.endDate).filter(row => {
      const start = mountainMidnight(row.date);
      const end = mountainMidnight(shiftDate(row.date, 1));
      return start < cutoff && range.start <= start && range.end >= end;
    });
    return {
      startedOn: firstAt === undefined ? null : mountainDate(firstAt),
      archiveStartedOn: oldest.get().date,
      cutoff,
      archived,
    };
  }
  return {seal, coverage, recordVisit: at => saveStart.run(at)};
}
