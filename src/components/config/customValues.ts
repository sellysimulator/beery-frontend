/**
 * Parsing for a pasted or dropped `CUSTOM` demand series.
 *
 * A host arrives with a column out of a spreadsheet, a comma-separated line, or
 * a one-column CSV file. All three are the same thing once the separators are
 * normalised, and the trailing newline a text editor or `csv` export leaves
 * behind must not become a fourth, empty week: `"4,4,8,\n"` is three values
 * (`18` FM 9).
 */

/** One entry per non-empty token, in order, with the tokens that did not parse. */
export interface ParsedSeries {
  values: number[]
  /** The raw tokens that were not whole numbers, for the inline message. */
  rejected: string[]
}

/**
 * Splits on commas, semicolons, whitespace and newlines, drops empty tokens,
 * and keeps whole numbers only.
 *
 * Fractional input is rejected rather than rounded: quantities are integers
 * everywhere (`00-conventions.md` section 4) and silently turning `4.6` into
 * `5` hides a mistake in a series the host will not read back week by week.
 */
export function parseCustomValues(raw: string): ParsedSeries {
  const values: number[] = []
  const rejected: string[] = []

  for (const token of raw.split(/[\s,;]+/)) {
    const trimmed = token.trim()
    if (!trimmed) continue

    const parsed = Number(trimmed)
    if (Number.isInteger(parsed) && parsed >= 0) {
      values.push(parsed)
    } else {
      rejected.push(trimmed)
    }
  }

  return { values, rejected }
}

/** The textarea's content for a stored series. */
export function formatCustomValues(values: number[]): string {
  return values.join(', ')
}

/**
 * Reads a dropped file as text.
 *
 * `File.text()` is used when it exists and `FileReader` covers the rest; jsdom
 * and older Safari differ on which they provide, and a host dropping a CSV is
 * not a path worth losing to that.
 */
export async function readDroppedFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsText(file)
  })
}
