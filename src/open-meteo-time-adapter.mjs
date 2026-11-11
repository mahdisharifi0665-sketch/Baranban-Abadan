// Converts Open-Meteo local wall-clock hourly labels into explicit UTC intervals.
// Open-Meteo precipitation is the sum over the preceding hour, so a value labelled t
// represents [t - 1 hour, t). See the provider's hourly variable definitions.

function parseLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new TypeError("Expected local ISO timestamp YYYY-MM-DDTHH:mm[:ss]");
  const parts = match.slice(1).map((v,i)=>v === undefined ? 0 : Number(v));
  const [year,month,day,hour,minute,second] = parts;
  const check = new Date(Date.UTC(year,month-1,day,hour,minute,second));
  if (check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day ||
      check.getUTCHours()!==hour || check.getUTCMinutes()!==minute || check.getUTCSeconds()!==second) {
    throw new TypeError("Invalid local calendar date/time");
  }
  return {year,month,day,hour,minute,second};
}

function zonedParts(epochMs, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(epochMs)).filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));
  return {year:parts.year,month:parts.month,day:parts.day,hour:parts.hour,minute:parts.minute,second:parts.second};
}

export function localDateTimeToUtc(localDateTime, timeZone="Asia/Tehran") {
  const target=parseLocal(localDateTime);
  const naive=Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute,target.second);
  let guess=naive;
  for (let i=0;i<6;i++) {
    const shown=zonedParts(guess,timeZone);
    const shownAsUtc=Date.UTC(shown.year,shown.month-1,shown.day,shown.hour,shown.minute,shown.second);
    const next=naive-(shownAsUtc-guess);
    if (next===guess) break;
    guess=next;
  }
  const roundTrip=zonedParts(guess,timeZone);
  if (Object.keys(target).some(k=>roundTrip[k]!==target[k])) {
    throw new RangeError("Local time is nonexistent or ambiguous in the requested timezone");
  }
  return new Date(guess).toISOString();
}

function nextDate(date) {
  const [y,m,d]=date.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);
}

export function calendarDayWindow(date, timeZone="Asia/Tehran") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError("Expected YYYY-MM-DD date");
  const next=nextDate(date);
  return {
    start:localDateTimeToUtc(date+"T00:00",timeZone),
    end:localDateTimeToUtc(next+"T00:00",timeZone),
    timeZone,
    localDate:date
  };
}

export function buildHourlyPrecipitationIntervals(times, values, unit, timeZone="Asia/Tehran") {
  if (!Array.isArray(times) || !Array.isArray(values) || times.length===0 || times.length!==values.length) {
    throw new TypeError("Hourly time/value arrays must be non-empty and equal length");
  }
  if (unit!=="mm") throw new TypeError("Precipitation unit must be mm");
  const intervals=[];
  let previousEnd=null;
  for (let i=0;i<times.length;i++) {
    const end=Date.parse(localDateTimeToUtc(times[i],timeZone));
    const start=end-3600000;
    if (previousEnd!==null && start!==previousEnd) throw new RangeError("Hourly labels are not contiguous");
    intervals.push({
      start:new Date(start).toISOString(),
      end:new Date(end).toISOString(),
      value:values[i],
      unit:"mm"
    });
    previousEnd=end;
  }
  return intervals;
}

export function requiredHourlyLabelsForCalendarDay(date, timeZone="Asia/Tehran") {
  const next=nextDate(date);
  const labels=[];
  const start=Date.parse(localDateTimeToUtc(date+"T01:00",timeZone));
  const end=Date.parse(localDateTimeToUtc(next+"T00:00",timeZone));
  for (let t=start;t<=end;t+=3600000) {
    const d=new Date(t);
    const parts=new Intl.DateTimeFormat("en-CA",{
      timeZone,year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",hourCycle:"h23"
    }).formatToParts(d);
    const p=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    labels.push(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`);
  }
  return labels;
}

export function utcHourlyForecastWindow(nowMs=Date.now(),expectedHours=240) {
  if(!Number.isFinite(nowMs)||!Number.isInteger(expectedHours)||expectedHours<1)throw new TypeError("invalid_utc_forecast_window_options");
  const coverageStartMs=Math.ceil(nowMs/3600000)*3600000;
  const firstLabelMs=coverageStartMs+3600000;
  const lastLabelMs=coverageStartMs+expectedHours*3600000;
  return {
    startHour:new Date(firstLabelMs).toISOString().slice(0,16),
    endHour:new Date(lastLabelMs).toISOString().slice(0,16),
    expectedHours,
    coverageStartUtc:new Date(coverageStartMs).toISOString(),
    coverageEndUtc:new Date(lastLabelMs).toISOString()
  };
}
