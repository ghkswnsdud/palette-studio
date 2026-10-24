// 색상 형식 변환과 명도 대비 계산을 담당하는 도구 함수 모음입니다.
// 외부 라이브러리 없이 순수 계산만으로 동작합니다.

export interface RGB {
  r: number // 0~255
  g: number
  b: number
}

export interface HSL {
  h: number // 0~360 (색상환 각도)
  s: number // 0~100 (채도 %)
  l: number // 0~100 (밝기 %)
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * 사용자가 입력한 HEX 문자열을 '#RRGGBB' 형태로 정리합니다.
 * '#abc', 'abc', 'AABBCC' 등을 허용하고, 잘못된 값이면 null을 돌려줍니다.
 */
export function normalizeHex(input: string): string | null {
  let value = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    value = value
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  return '#' + value.toUpperCase()
}

/** 입력 중인 HEX 값에 허용되지 않는 문자가 섞였는지 (자릿수는 따지지 않음) */
export const hasInvalidHexChars = (input: string) => !/^#?[0-9a-fA-F]*$/.test(input.trim())

/**
 * HEX 입력칸의 값을 검사해 문제가 있으면 안내 문구를, 올바르면 null을 돌려줍니다.
 * 올바른 값: '#4D7CFE', '4d7cfe', '#FA0', 'fa0' (앞뒤 공백 허용)
 */
export function validateHexInput(input: string): string | null {
  const value = input.trim()
  if (value === '') return 'HEX 코드를 입력해 주세요.'
  if (hasInvalidHexChars(value)) return '0~9, A~F 문자만 사용할 수 있습니다.'
  if (!normalizeHex(value)) return '6자리(예: #4D7CFE) 또는 3자리(예: #FA0)로 입력해 주세요.'
  return null
}

export function hexToRgb(hex: string): RGB {
  const value = (normalizeHex(hex) ?? '#000000').slice(1)
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) =>
    Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
  return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase()
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  let h = 0
  let s = 0
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let [r1, g1, b1] = [0, 0, 0]
  if (hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const m = ln - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

export const hexToHsl = (hex: string) => rgbToHsl(hexToRgb(hex))
export const hslToHex = (hsl: HSL) => rgbToHex(hslToRgb(hsl))

/** CIELAB 색공간: 사람 눈이 느끼는 색 차이를 거리로 계산하기 좋은 형식 */
export interface Lab {
  l: number
  a: number
  b: number
}

/** RGB → CIELAB (D65 기준) 변환 */
export function rgbToLab({ r, g, b }: RGB): Lab {
  const linear = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const lr = linear(r)
  const lg = linear(g)
  const lb = linear(b)
  // sRGB → XYZ 정밀 계수. 각 행의 합이 기준 흰색(D65: 0.95047, 1, 1.08883)과 맞아야
  // 흰색·회색이 정확히 무채색(a = b = 0)으로 계산됩니다.
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/**
 * 두 색의 차이 ΔE(CIE76). 약 2 이하는 거의 구분되지 않고,
 * 10 이상이면 확실히 다른 색으로 느껴집니다.
 */
export function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2)
}

/** WCAG 기준 상대 휘도 (0 = 검정, 1 = 흰색) */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 두 색의 명도 대비 (1 ~ 21). 4.5 이상이면 일반 글자도 잘 읽힙니다. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

export type WcagGrade = 'AAA' | 'AA' | 'AA 큰 글자' | '부족'

/**
 * WCAG 2.x 텍스트 대비 등급
 * - AAA: 7 이상 (가장 읽기 쉬움)
 * - AA: 4.5 이상 (일반 본문 글자 기준)
 * - AA 큰 글자: 3 이상 (18pt 이상 또는 굵은 14pt 이상의 큰 글자만 통과)
 */
export function wcagGrade(ratio: number): WcagGrade {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA 큰 글자'
  return '부족'
}

/** 배경색 위에 올릴 글자색으로 흰색/검정 중 더 잘 보이는 쪽을 고릅니다. */
export function readableTextColor(bgHex: string): '#FFFFFF' | '#111111' {
  return contrastRatio(bgHex, '#FFFFFF') >= contrastRatio(bgHex, '#111111')
    ? '#FFFFFF'
    : '#111111'
}
