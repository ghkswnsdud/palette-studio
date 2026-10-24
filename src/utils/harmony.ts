// 배색(색상 조화) 추천 로직입니다.
//
// 왜 HSL이 아니라 OKLCH인가?
// - HSL은 계산이 쉽지만, 같은 L(밝기) 값이라도 노랑은 매우 밝고 파랑은 어둡게 보입니다.
//   그래서 HSL로 색상 각도만 돌리면 추천 색끼리 밝기가 들쭉날쭉해집니다.
// - OKLCH는 사람 눈의 지각에 맞춰 설계된 색공간이라, 각도(h)를 돌려도
//   보이는 밝기(L)와 선명도(C)가 거의 그대로 유지됩니다.
// - 단, OKLCH의 모든 색을 모니터(sRGB)가 표현할 수는 없으므로,
//   범위를 벗어나면 L과 h는 유지한 채 C(채도)만 줄여서 맞춥니다.

import { hexToRgb, rgbToHex, type RGB } from './color'

export interface Oklch {
  /** 지각 밝기 0~1 */
  l: number
  /** 선명도(채도) 0~약 0.37 (sRGB 기준 최대값) */
  c: number
  /** 색상환 각도 0 이상 360 미만 */
  h: number
}

/** 이보다 채도가 낮으면 무채색(회색 계열)으로 보고 배색 추천 시 안내합니다. */
export const ACHROMATIC_CHROMA = 0.02
/** 이보다 채도가 낮으면 색상 각도는 계산 오차뿐이므로 0으로 둡니다. (흰색, 검정, 순수 회색) */
const HUE_NOISE = 1e-4
/** sRGB에서 표현 가능한 OKLCH 채도의 대략적인 최대값 (막대 그래프 기준) */
export const MAX_SRGB_CHROMA = 0.37

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * 각도를 0 이상 360 미만으로 정리합니다.
 * 예: 370 → 10, -30 → 330, 360 → 0, NaN → 0
 */
export function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0
  const h = ((hue % 360) + 360) % 360
  // 부동소수점 오차로 360에 아주 가까운 값이 나오면 0으로 맞춥니다. (-0도 0으로)
  return h >= 360 - 1e-9 || h === 0 ? 0 : h
}

/** 두 각도 사이의 가장 짧은 거리 (0~180) */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(normalizeHue(a) - normalizeHue(b))
  return d > 180 ? 360 - d : d
}

/** 기준 각도에서 offset만큼 회전한 각도 */
export const rotateHue = (hue: number, offset: number) => normalizeHue(hue + offset)

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255

/** sRGB → OKLCH (Björn Ottosson의 OKLab 공식) */
export function rgbToOklch({ r, g, b }: RGB): Oklch {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.hypot(A, B)
  // 채도가 계산 오차 수준일 때만 각도를 버립니다. (옅은 회색 계열도 고유의 색상 각도를 유지)
  const h = c < HUE_NOISE ? 0 : normalizeHue((Math.atan2(B, A) * 180) / Math.PI)
  return { l: clamp(L, 0, 1), c, h }
}

export const hexToOklch = (hex: string) => rgbToOklch(hexToRgb(hex))

/** OKLCH → 선형 sRGB (0~1 범위를 벗어날 수 있음) */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ]
}

const EPS = 1e-4
const inGamut = (rgb: number[]) => rgb.every((v) => v >= -EPS && v <= 1 + EPS)

/** 모니터에서 표현할 수 있는 색인지 확인합니다. */
export const isInSrgbGamut = (color: Oklch) => inGamut(oklchToLinear(color))

/**
 * OKLCH → HEX. 표현할 수 없는 색이면 밝기·색상은 유지하고
 * 채도만 이진 탐색으로 줄여 가장 가까운 표현 가능한 색을 찾습니다.
 */
export function oklchToHex(color: Oklch): string {
  // 밝기 0은 검정, 1은 흰색입니다. (이 끝에서는 채도가 의미 없음)
  if (color.l <= 0) return '#000000'
  if (color.l >= 1) return '#FFFFFF'
  const target = { l: color.l, c: Math.max(0, color.c), h: normalizeHue(color.h) }
  let linear = oklchToLinear(target)
  if (!inGamut(linear)) {
    let lo = 0
    let hi = target.c
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ ...target, c: mid }))) lo = mid
      else hi = mid
    }
    linear = oklchToLinear({ ...target, c: lo })
  }
  const [r, g, b] = linear.map((v) => fromLinear(clamp(v, 0, 1)))
  return rgbToHex({ r, g, b })
}

export type HarmonyKind = 'analogous' | 'complementary' | 'split' | 'triadic'

export interface HarmonyRule {
  kind: HarmonyKind
  label: string
  description: string
  /** 기준 색에서 회전할 각도 목록 (0 = 기준 색) */
  offsets: number[]
}

export const HARMONY_RULES: HarmonyRule[] = [
  {
    kind: 'analogous',
    label: '유사색',
    description: '색상환에서 ±30° 이웃한 색. 차분하고 자연스러운 조합입니다.',
    offsets: [-30, 0, 30],
  },
  {
    kind: 'complementary',
    label: '보색',
    description: '정반대(180°)의 색. 대비가 가장 강해 강조색에 좋습니다.',
    offsets: [0, 180],
  },
  {
    kind: 'split',
    label: '분할 보색',
    description: '보색 양옆(150°, 210°)의 두 색. 보색보다 부드러운 대비입니다.',
    offsets: [0, 150, 210],
  },
  {
    kind: 'triadic',
    label: '삼색',
    description: '120°씩 떨어진 세 색. 균형 잡히고 활기찬 조합입니다.',
    offsets: [0, 120, 240],
  },
]

export interface HarmonyColor {
  hex: string
  /** 추천 색의 OKLCH 색상 각도 */
  hue: number
  offset: number
}

export interface HarmonyResult extends HarmonyRule {
  colors: HarmonyColor[]
}

/** 기준 색 하나로 모든 배색 규칙의 추천 색을 계산합니다. */
export function buildHarmonies(baseHex: string): HarmonyResult[] {
  const base = hexToOklch(baseHex)
  return HARMONY_RULES.map((rule) => ({
    ...rule,
    colors: rule.offsets.map((offset) => {
      const hue = rotateHue(base.h, offset)
      // 기준 색은 변환 오차 없이 원래 HEX를 그대로 씁니다.
      const hex = offset === 0 ? baseHex.toUpperCase() : oklchToHex({ ...base, h: hue })
      return { hex, hue, offset }
    }),
  }))
}

/** 무채색이면 색상환 기반 추천이 의미가 없어 안내가 필요합니다. */
export const isAchromatic = (hex: string) => hexToOklch(hex).c < ACHROMATIC_CHROMA
