declare module 'japanese-holidays' {
  export function isHoliday(date: Date, includeSunday?: boolean): string | undefined;
  export function getHolidaysOf(year: number): any[];
}
