import type { FunctionImpl } from "./functions-runtime";
import {
  asDate,
  boolean,
  dayFraction,
  flatten,
  number,
  scalarOf,
  text,
  weekNumber,
} from "./functions-runtime";

export const TEXT_FUNCTIONS: Record<string, FunctionImpl> = {
  // --- text ---
  LEN: (args) => text(scalarOf(args[0])).length,
  LEFT: (args) => text(scalarOf(args[0])).slice(0, args[1] === undefined ? 1 : number(scalarOf(args[1]))),
  RIGHT: (args) => {
    const value = text(scalarOf(args[0]));
    const count = args[1] === undefined ? 1 : number(scalarOf(args[1]));
    return count === 0 ? "" : value.slice(-count);
  },
  MID: (args) => {
    const value = text(scalarOf(args[0]));
    const start = Math.trunc(number(scalarOf(args[1])));
    const count = number(scalarOf(args[2]));
    if (start < 1 || count < 0) throw new Error("#VALUE!");
    return value.slice(start - 1, start - 1 + count);
  },
  UPPER: (args) => text(scalarOf(args[0])).toUpperCase(),
  LOWER: (args) => text(scalarOf(args[0])).toLowerCase(),
  PROPER: (args) =>
    text(scalarOf(args[0]))
      .toLowerCase()
      .replace(/(^|[^a-z])([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase()),
  TRIM: (args) => text(scalarOf(args[0])).trim().replace(/\s+/g, " "),
  CLEAN: (args) => text(scalarOf(args[0])).split("").filter((char) => char.charCodeAt(0) > 31).join(""),
  REPT: (args) => {
    const count = Math.trunc(number(scalarOf(args[1])));
    if (count < 0) throw new Error("#VALUE!");
    return text(scalarOf(args[0])).repeat(count);
  },
  CONCATENATE: (args, ctx) => {
    const flat = args.flatMap((argument) => flatten(argument, ctx));
    return flat.map(text).join("");
  },
  TEXTJOIN: (args, ctx) => {
    const delimiter = text(scalarOf(args[0]));
    const ignoreEmpty = boolean(scalarOf(args[1]));
    const flat = args.slice(2).flatMap((argument) => flatten(argument, ctx));
    const pieces = flat.map(text);
    return (ignoreEmpty ? pieces.filter((piece) => piece !== "") : pieces).join(delimiter);
  },
  VALUE: (args) => {
    const value = text(scalarOf(args[0])).trim().replace(/,/g, "");
    if (value === "") return 0;
    const percent = value.endsWith("%");
    const numeric = Number(percent ? value.slice(0, -1) : value);
    if (!Number.isFinite(numeric)) throw new Error("#VALUE!");
    return percent ? numeric / 100 : numeric;
  },
  TEXT: (args) => {
    const value = number(scalarOf(args[0]));
    const mask = text(scalarOf(args[1]));
    const percent = mask.includes("%");
    const working = percent ? value * 100 : value;
    const decimalPlaces = Math.max(0, (/\.0+/.exec(mask)?.[0].length ?? 1) - 1);
    const grouped = mask.includes(",");
    let body = working.toFixed(Math.max(0, decimalPlaces ?? 0));
    if (grouped) {
      const [integers, decimals] = body.split(".");
      body = Number(integers).toLocaleString("en-GB") + (decimals ? `.${decimals}` : "");
    }
    return percent ? `${body}%` : body;
  },
  FIND: (args) => {
    const needle = text(scalarOf(args[0]));
    const haystack = text(scalarOf(args[1]));
    const start = args[2] === undefined ? 1 : Math.trunc(number(scalarOf(args[2])));
    const index = haystack.indexOf(needle, start - 1);
    if (index < 0) throw new Error("#VALUE!");
    return index + 1;
  },
  SEARCH: (args) => {
    const needle = text(scalarOf(args[0])).toLowerCase();
    const haystack = text(scalarOf(args[1])).toLowerCase();
    const start = args[2] === undefined ? 1 : Math.trunc(number(scalarOf(args[2])));
    const index = haystack.indexOf(needle, start - 1);
    if (index < 0) throw new Error("#VALUE!");
    return index + 1;
  },
  REPLACE: (args) => {
    const value = text(scalarOf(args[0]));
    const start = Math.trunc(number(scalarOf(args[1])));
    const count = number(scalarOf(args[2]));
    const replacement = text(scalarOf(args[3]));
    if (start < 1) throw new Error("#VALUE!");
    return value.slice(0, start - 1) + replacement + value.slice(start - 1 + count);
  },
  SUBSTITUTE: (args) => {
    const value = text(scalarOf(args[0]));
    const oldText = text(scalarOf(args[1]));
    const newText = text(scalarOf(args[2]));
    if (oldText === "") return value;
    const instance = args[3] === undefined ? undefined : Math.trunc(number(scalarOf(args[3])));
    if (instance === undefined) return value.split(oldText).join(newText);
    let index = -1;
    for (let seen = 0; seen < instance; seen++) {
      index = value.indexOf(oldText, index + 1);
      if (index < 0) return value;
    }
    return value.slice(0, index) + newText + value.slice(index + oldText.length);
  },

  // --- date / time ---
  TIME: (args) =>
    dayFraction(
      args[0] === undefined ? 0 : number(scalarOf(args[0])),
      args[1] === undefined ? 0 : number(scalarOf(args[1])),
      args[2] === undefined ? 0 : number(scalarOf(args[2])),
    ),
  HOUR: (args) => asDate(scalarOf(args[0])).getUTCHours(),
  MINUTE: (args) => asDate(scalarOf(args[0])).getUTCMinutes(),
  SECOND: (args) => asDate(scalarOf(args[0])).getUTCSeconds(),
  DATEVALUE: (args) => asDate(scalarOf(args[0])),
  TIMEVALUE: (args) => {
    const value = scalarOf(args[0]);
    // Excel's time text is "13:30", "13:30:15" or "1:30 PM"; ISO datetime
    // strings (and serials) keep working through the date codec.
    if (typeof value === "string") {
      const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*([AaPp][Mm])?$/.exec(value.trim());
      if (match) {
        let hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3] ?? 0);
        const meridiem = match[5]?.toUpperCase();
        if (meridiem === "PM" && hours < 12) hours += 12;
        else if (meridiem === "AM" && hours === 12) hours = 0;
        if (hours > 23 || minutes > 59 || seconds > 59) throw new Error("#VALUE!");
        return dayFraction(hours, minutes, seconds);
      }
    }
    const parsed = asDate(value);
    return dayFraction(parsed.getUTCHours(), parsed.getUTCMinutes(), parsed.getUTCSeconds());
  },
  WEEKDAY: (args) => {
    const day = asDate(scalarOf(args[0])).getUTCDay();
    const type = args[1] === undefined ? 1 : Math.trunc(number(scalarOf(args[1])));
    if (type === 1) return day + 1;
    if (type === 2) return day === 0 ? 7 : day;
    if (type === 3) return day === 0 ? 6 : day - 1;
    return day + 1;
  },
  WEEKNUM: (args) => weekNumber(asDate(scalarOf(args[0])), args[1] === undefined ? 1 : Math.trunc(number(scalarOf(args[1])))),
  ISOWEEKNUM: (args) => {
    const dateValue = asDate(scalarOf(args[0]));
    const target = new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate()));
    const dayNumber = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNumber + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
    return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  },
  EDATE: (args) => {
    const dateValue = asDate(scalarOf(args[0]));
    const months = Math.trunc(number(scalarOf(args[1])));
    const shifted = new Date(dateValue);
    shifted.setUTCDate(1);
    shifted.setUTCMonth(shifted.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
    shifted.setUTCDate(Math.min(dateValue.getUTCDate(), lastDay));
    return shifted;
  },
  EOMONTH: (args) => {
    const dateValue = asDate(scalarOf(args[0]));
    const months = Math.trunc(number(scalarOf(args[1])));
    const shifted = new Date(dateValue);
    shifted.setUTCDate(1);
    shifted.setUTCMonth(shifted.getUTCMonth() + months + 1);
    shifted.setUTCDate(0);
    return shifted;
  },
  DATEDIF: (args) => {
    const start = asDate(scalarOf(args[0]));
    const end = asDate(scalarOf(args[1]));
    const unit = text(scalarOf(args[2])).toUpperCase();
    if (end < start) throw new Error("#NUM!");
    const years = end.getUTCFullYear() - start.getUTCFullYear();
    const months = years * 12 + (end.getUTCMonth() - start.getUTCMonth());
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (unit === "Y") return months < 12 ? 0 : end < new Date(Date.UTC(end.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) ? years - 1 : years;
    if (unit === "M") return end < new Date(Date.UTC(end.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) ? months - 1 : months;
    if (unit === "D") return days;
    if (unit === "YM") {
      const diff = end.getUTCMonth() - start.getUTCMonth() + (end.getUTCDate() < start.getUTCDate() ? -1 : 0);
      return (diff + 12) % 12;
    }
    if (unit === "YD") {
      const anchor = new Date(Date.UTC(end.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      return Math.round((end.getTime() - (end < anchor ? anchor.getTime() - 365 * 86_400_000 : anchor.getTime())) / 86_400_000);
    }
    if (unit === "MD") return end.getUTCDate() >= start.getUTCDate() ? end.getUTCDate() - start.getUTCDate() : end.getUTCDate();
    throw new Error("#VALUE!");
  },
  NETWORKDAYS: (args, ctx) => {
    const start = asDate(scalarOf(args[0]));
    const end = asDate(scalarOf(args[1]));
    const holidays = args[2] === undefined ? [] : flatten(args[2], ctx).map(asDate);
    const holidayKeys = new Set(holidays.map((date) => date.toISOString().slice(0, 10)));
    const direction = end < start ? -1 : 1;
    let count = 0;
    const cursor = new Date(start);
    while (direction === 1 ? cursor <= end : cursor >= end) {
      const day = cursor.getUTCDay();
      const key = cursor.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6 && !holidayKeys.has(key)) count += direction;
      cursor.setUTCDate(cursor.getUTCDate() + direction);
    }
    return count;
  },
  WORKDAY: (args, ctx) => {
    const start = asDate(scalarOf(args[0]));
    const days = Math.trunc(number(scalarOf(args[1])));
    const holidays = args[2] === undefined ? [] : flatten(args[2], ctx).map(asDate);
    const holidayKeys = new Set(holidays.map((date) => date.toISOString().slice(0, 10)));
    const direction = days < 0 ? -1 : 1;
    let remaining = Math.abs(days);
    const cursor = new Date(start);
    while (remaining > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + direction);
      const day = cursor.getUTCDay();
      const key = cursor.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6 && !holidayKeys.has(key)) remaining -= 1;
    }
    return cursor;
  },

};
