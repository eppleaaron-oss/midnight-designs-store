export const REPORTING_ZONE = 'America/Denver';
export const DAY = 86400000;
export const RETENTION_DAYS = 180;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en', {
  timeZone: REPORTING_ZONE, timeZoneName: 'longOffset',
});
const presetDays = new Map([['today', 1], ['yesterday', 1], ['7', 7], ['30', 30], ['90', 90], ['365', 365], ['all', 180]]);

export function mountainDate(at) {
  return dateFormatter.format(at);
}

export function shiftDate(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && shiftDate(date, 0) === date;
}

function midnight(date) {
  const utc = Date.parse(date + 'T00:00:00Z');
  // Denver's offset at UTC midnight is also the offset at local midnight.
  const offset = offsetFormatter.formatToParts(utc).find(part => part.type === 'timeZoneName').value;
  const [, hours, minutes] = /^GMT-(\d\d):(\d\d)$/.exec(offset);
  return utc + (Number(hours) * 60 + Number(minutes)) * 60000;
}

export function reportingRange(params, now) {
  const period = params.get('period') || '30';
  const today = mountainDate(now);
  let endDate = period === 'yesterday' ? shiftDate(today, -1) : today;
  let startDate;
  if (period === 'custom') {
    startDate = params.get('start');
    endDate = params.get('end');
    if (!validDate(startDate) || !validDate(endDate) || startDate < '1970-01-01' ||
        startDate > endDate || endDate > today) {
      throw new RangeError('Choose a valid start and end date through today in Mountain Time.');
    }
  } else {
    const days = presetDays.get(period);
    if (!days) throw new RangeError('Choose a valid reporting period.');
    startDate = shiftDate(endDate, 1 - days);
  }
  const days = (Date.parse(endDate) - Date.parse(startDate)) / DAY + 1;
  const start = midnight(startDate);
  const end = Math.min(midnight(shiftDate(endDate, 1)), now + 1);
  return {
    period, start, end, startDate, endDate, today, now,
    previousStart: period === 'all' ? null : midnight(shiftDate(startDate, -days)),
  };
}
