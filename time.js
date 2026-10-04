'use strict';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function koreaTime(now = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    weekday: weekdays.indexOf(parts.weekday), hour: Number(parts.hour), minute: Number(parts.minute)
  };
}

function resetDate(now, hour) {
  const time = koreaTime(now);
  const date = new Date(Date.UTC(time.year, time.month - 1, time.day));
  if (time.hour < hour) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

module.exports = { koreaTime, resetDate };
