export const REPORTING_ZONE = 'America/Denver';
export const DAY = 86400000;
export const RETENTION_DAYS = 180;
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en', {
  timeZone: REPORTING_ZONE, timeZoneName: 'longOffset',
});
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORTING_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
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

function lastYear(date) {
  const [year, month, day] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function timeOfDay(at) {
  const [hours, minutes, seconds] = clockFormatter.format(at).split(':').map(Number);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + at % 1000;
}

function throughSameClock(date, now) {
  const dayStart = midnight(date);
  const nextStart = midnight(shiftDate(date, 1));
  const clock = timeOfDay(now);
  const first = dayStart + clock;
  const second = nextStart - DAY + clock;
  // On a repeated hour, prefer the matching offset when it exists.
  const matches = [first, second].filter(at => mountainDate(at) === date && timeOfDay(at) === clock);
  const offset = Date.parse(mountainDate(now)) + clock - now;
  const match = matches.find(at => Date.parse(date) + clock - at === offset) ?? matches[0];
  // If the comparison clock falls in a spring-forward gap, advance by the gap.
  return Math.min(nextStart, (match ?? first) + 1);
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
  const requestedGrouping = params.get('group') || 'auto';
  if (!['auto', 'hour', 'day', 'week', 'month'].includes(requestedGrouping)) {
    throw new RangeError('Choose Hour, Day, Week or Month.');
  }
  let grouping = requestedGrouping;
  if (grouping === 'auto') {
    if (days === 1) grouping = 'hour';
    else if (days <= 31) grouping = 'day';
    else if (days <= 120) grouping = 'week';
    else grouping = 'month';
  }
  if (grouping === 'hour' && days > 366) {
    throw new RangeError('Choose Day, Week or Month for a range longer than 366 days.');
  }
  const compare = params.get('compare') || (period === 'all' ? 'off' : 'previous');
  if (!['off', 'previous', 'year'].includes(compare)) {
    throw new RangeError('Choose a valid comparison.');
  }
  let baseline = null;
  if (compare !== 'off') {
    const previous = compare === 'previous';
    const from = previous ? shiftDate(startDate, -days) : lastYear(startDate);
    const to = previous ? shiftDate(startDate, -1) : lastYear(endDate);
    const comparisonStart = midnight(from);
    const comparisonEnd = days === 1 && endDate === today
      ? throughSameClock(to, now)
      : midnight(shiftDate(to, 1));
    baseline = {
      mode: compare,
      label: previous ? 'Previous period' : 'Same dates last year',
      start: comparisonStart, end: comparisonEnd, startDate: from, endDate: to,
      trafficAvailable: comparisonStart >= now - RETENTION_DAYS * DAY,
    };
  }
  return {period, start, end, startDate, endDate, today, now, grouping, baseline};
}
