/**
 * A small QR encoder, written here rather than added as a dependency because
 * the toolchain is pinned (D16) and this is the only place in the app that
 * needs one: the host lobby projects the invite link so a room of people can
 * join without typing a code.
 *
 * Deliberately narrow: byte mode, error-correction level M, versions 1-6.
 * That covers 106 bytes, and an invite link is
 * `https://<host>/join/<six characters>`. Anything longer returns `null` and
 * the caller falls back to showing the link as text, which is the same
 * information in a form that always works.
 */

/** [block count, data codewords per block] for one error-correction group. */
type EcGroup = readonly [number, number]

interface VersionSpec {
  /** Error-correction codewords per block, at level M. */
  ecPerBlock: number
  groups: readonly EcGroup[]
  /** Row/column centres of the alignment patterns. */
  alignment: readonly number[]
  /** Bits of padding after the last codeword, fixed per version. */
  remainderBits: number
}

const VERSIONS: readonly VersionSpec[] = [
  { ecPerBlock: 10, groups: [[1, 16]], alignment: [], remainderBits: 0 },
  { ecPerBlock: 16, groups: [[1, 28]], alignment: [6, 18], remainderBits: 7 },
  { ecPerBlock: 26, groups: [[1, 44]], alignment: [6, 22], remainderBits: 7 },
  { ecPerBlock: 18, groups: [[2, 32]], alignment: [6, 26], remainderBits: 7 },
  { ecPerBlock: 24, groups: [[2, 43]], alignment: [6, 30], remainderBits: 7 },
  { ecPerBlock: 16, groups: [[4, 27]], alignment: [6, 34], remainderBits: 7 },
]

/* ─── GF(256), primitive polynomial 0x11d ─── */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

;(() => {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255]!
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!
}

/** The generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j]!, 1)
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, GF_EXP[i]!)
    }
    poly = next
  }
  return poly
}

function rsRemainder(data: readonly number[], degree: number): number[] {
  const generator = rsGenerator(degree)
  const remainder = new Array<number>(degree).fill(0)

  for (const byte of data) {
    const factor = byte ^ remainder[0]!
    remainder.shift()
    remainder.push(0)
    if (factor !== 0) {
      for (let i = 0; i < degree; i += 1) {
        remainder[i] = remainder[i]! ^ gfMul(generator[i + 1]!, factor)
      }
    }
  }

  return remainder
}

/* ─── bit stream ─── */

class BitBuffer {
  private readonly bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1)
  }

  get length(): number {
    return this.bits.length
  }

  toCodewords(count: number): number[] {
    const codewords = new Array<number>(count).fill(0)
    for (let i = 0; i < this.bits.length; i += 1) {
      if (this.bits[i] === 1) codewords[i >> 3]! |= 0x80 >> (i & 7)
    }
    return codewords
  }
}

/* ─── matrix construction ─── */

const UNSET = -1

interface Canvas {
  size: number
  modules: Int8Array
  reserved: Uint8Array
}

function makeCanvas(size: number): Canvas {
  return {
    size,
    modules: new Int8Array(size * size).fill(UNSET),
    reserved: new Uint8Array(size * size),
  }
}

function setFunction(canvas: Canvas, row: number, col: number, dark: boolean): void {
  const index = row * canvas.size + col
  canvas.modules[index] = dark ? 1 : 0
  canvas.reserved[index] = 1
}

function placeFinder(canvas: Canvas, row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r
      const cc = col + c
      if (rr < 0 || rr >= canvas.size || cc < 0 || cc >= canvas.size) continue
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
      setFunction(canvas, rr, cc, inRing || inCore)
    }
  }
}

function placeAlignment(canvas: Canvas, centres: readonly number[]): void {
  for (const row of centres) {
    for (const col of centres) {
      const nearFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === canvas.size - 7) ||
        (row === canvas.size - 7 && col === 6)
      if (nearFinder) continue
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const ring = Math.max(Math.abs(r), Math.abs(c))
          setFunction(canvas, row + r, col + c, ring !== 1)
        }
      }
    }
  }
}

function reserveFormatAreas(canvas: Canvas, version: number): void {
  const last = canvas.size - 1
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      canvas.reserved[8 * canvas.size + i] = 1
      canvas.reserved[i * canvas.size + 8] = 1
    }
  }
  for (let i = 0; i < 8; i += 1) {
    canvas.reserved[8 * canvas.size + (last - i)] = 1
    canvas.reserved[(last - i) * canvas.size + 8] = 1
  }
  // The one module that is always dark, at (4 * version + 9, 8).
  setFunction(canvas, 4 * version + 9, 8, true)
}

function placeFunctionPatterns(canvas: Canvas, version: number): void {
  const spec = VERSIONS[version - 1]!
  placeFinder(canvas, 0, 0)
  placeFinder(canvas, 0, canvas.size - 7)
  placeFinder(canvas, canvas.size - 7, 0)

  for (let i = 8; i < canvas.size - 8; i += 1) {
    const dark = i % 2 === 0
    setFunction(canvas, 6, i, dark)
    setFunction(canvas, i, 6, dark)
  }

  placeAlignment(canvas, spec.alignment)
  reserveFormatAreas(canvas, version)
}

/** Standard upward/downward zigzag from the bottom-right, skipping column 6. */
function placeData(canvas: Canvas, codewords: readonly number[], remainderBits: number): void {
  const bits: number[] = []
  for (const codeword of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((codeword >>> i) & 1)
  }
  for (let i = 0; i < remainderBits; i += 1) bits.push(0)

  let cursor = 0
  let upward = true

  for (let right = canvas.size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; the pair shifts left past it,
    // and every later pair is measured from the shifted position.
    if (right === 6) right = 5
    for (let step = 0; step < canvas.size; step += 1) {
      const row = upward ? canvas.size - 1 - step : step
      for (const col of [right, right - 1]) {
        const index = row * canvas.size + col
        if (canvas.reserved[index]) continue
        canvas.modules[index] = (bits[cursor] ?? 0) as 0 | 1
        cursor += 1
      }
    }
    upward = !upward
  }
}

const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

/** Level M is `0b00`; the 15-bit format string is BCH(15, 5) plus a fixed XOR. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask
  let value = data << 10
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >>> (i + 10)) & 1) value ^= 0x537 << i
  }
  return ((data << 10) | value) ^ 0x5412
}

function applyFormat(canvas: Canvas, mask: number): void {
  const bits = formatBits(mask)
  const size = canvas.size

  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1

    // The copy running down column 8, then along the bottom of that column.
    if (i < 6) setFunction(canvas, i, 8, dark)
    else if (i < 8) setFunction(canvas, i + 1, 8, dark)
    else setFunction(canvas, size - 15 + i, 8, dark)

    // The copy running right-to-left along row 8.
    if (i < 8) setFunction(canvas, 8, size - 1 - i, dark)
    else if (i < 9) setFunction(canvas, 8, 15 - i, dark)
    else setFunction(canvas, 8, 14 - i, dark)
  }
}

function runPenalty(run: number): number {
  return run >= 5 ? 3 + (run - 5) : 0
}

const FINDER_RUN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]

function linePenalty(line: readonly number[]): number {
  let score = 0
  let run = 1

  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === line[i - 1]) {
      run += 1
    } else {
      score += runPenalty(run)
      run = 1
    }
  }
  score += runPenalty(run)

  for (let i = 0; i + 11 <= line.length; i += 1) {
    const forward = FINDER_RUN.every((bit, k) => line[i + k] === bit)
    const backward = FINDER_RUN.every((bit, k) => line[i + 10 - k] === bit)
    if (forward || backward) score += 40
  }

  return score
}

function penalty(modules: Int8Array, size: number): number {
  let score = 0

  for (let i = 0; i < size; i += 1) {
    const row: number[] = []
    const col: number[] = []
    for (let j = 0; j < size; j += 1) {
      row.push(modules[i * size + j]!)
      col.push(modules[j * size + i]!)
    }
    score += linePenalty(row) + linePenalty(col)
  }

  for (let r = 0; r + 1 < size; r += 1) {
    for (let c = 0; c + 1 < size; c += 1) {
      const first = modules[r * size + c]
      if (
        modules[r * size + c + 1] === first &&
        modules[(r + 1) * size + c] === first &&
        modules[(r + 1) * size + c + 1] === first
      ) {
        score += 3
      }
    }
  }

  let dark = 0
  for (let i = 0; i < modules.length; i += 1) if (modules[i] === 1) dark += 1
  const percent = (dark * 100) / modules.length
  score += Math.floor(Math.abs(percent - 50) / 5) * 10

  return score
}

/* ─── encoding ─── */

function dataCodewordCount(spec: VersionSpec): number {
  return spec.groups.reduce((total, [blocks, size]) => total + blocks * size, 0)
}

function chooseVersion(byteLength: number): number | null {
  for (let version = 1; version <= VERSIONS.length; version += 1) {
    const capacityBits = dataCodewordCount(VERSIONS[version - 1]!) * 8
    if (4 + 8 + byteLength * 8 <= capacityBits) return version
  }
  return null
}

function interleave(spec: VersionSpec, data: readonly number[]): number[] {
  const blocks: number[][] = []
  const ecBlocks: number[][] = []

  let offset = 0
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i += 1) {
      const block = data.slice(offset, offset + size)
      offset += size
      blocks.push(block)
      ecBlocks.push(rsRemainder(block, spec.ecPerBlock))
    }
  }

  const result: number[] = []
  const longest = Math.max(...blocks.map((block) => block.length))
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.length) result.push(block[i]!)
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i]!)
  }

  return result
}

/**
 * Encodes `data` as a QR symbol: a square matrix of modules, row-major, with
 * `true` for a dark module and no quiet zone. Returns `null` when `data`
 * exceeds the capacity of the largest supported version — 106 bytes at
 * version 6, error-correction level M.
 *
 * **Capacity is counted in bytes, not characters.** The string is encoded to
 * UTF-8 first, so 53 `é` (106 bytes) encodes and 54 (108 bytes) does not,
 * while `data.length` reads 54 in both cases and is far below any limit.
 * Measuring the string length instead would produce a corrupt symbol exactly
 * there.
 *
 * The mask pattern is chosen by the standard's penalty rules and is not part
 * of this contract: a symbol carries its mask in its own format information
 * and all eight decode to the same data.
 */
export function encodeQr(data: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(data))
  const version = chooseVersion(bytes.length)
  if (version === null) return null

  const spec = VERSIONS[version - 1]!
  const totalData = dataCodewordCount(spec)

  const buffer = new BitBuffer()
  buffer.push(0b0100, 4)
  buffer.push(bytes.length, 8)
  for (const byte of bytes) buffer.push(byte, 8)
  buffer.push(0, Math.min(4, totalData * 8 - buffer.length))
  if (buffer.length % 8 !== 0) buffer.push(0, 8 - (buffer.length % 8))

  const codewords = buffer.toCodewords(totalData)
  const used = Math.ceil(buffer.length / 8)
  for (let i = used; i < totalData; i += 1) {
    codewords[i] = (i - used) % 2 === 0 ? 0xec : 0x11
  }

  const finalCodewords = interleave(spec, codewords)
  const size = 17 + 4 * version

  const base = makeCanvas(size)
  placeFunctionPatterns(base, version)
  placeData(base, finalCodewords, spec.remainderBits)

  let best: Int8Array | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (let mask = 0; mask < MASKS.length; mask += 1) {
    const candidate = makeCanvas(size)
    candidate.modules.set(base.modules)
    candidate.reserved.set(base.reserved)

    const rule = MASKS[mask]!
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        const index = r * size + c
        if (base.reserved[index]) continue
        if (rule(r, c)) candidate.modules[index] = candidate.modules[index] === 1 ? 0 : 1
      }
    }
    applyFormat(candidate, mask)

    const score = penalty(candidate.modules, size)
    if (score < bestScore) {
      bestScore = score
      best = candidate.modules
    }
  }

  const matrix: boolean[][] = []
  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = new Array<boolean>(size)
    for (let col = 0; col < size; col += 1) line[col] = best![row * size + col] === 1
    matrix.push(line)
  }
  return matrix
}
