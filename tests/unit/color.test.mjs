// 색상 변환 함수, HEX 유효성 검사, 배색 계산 경계값 단위 테스트
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true }, logLevel: 'error' })
const C = await server.ssrLoadModule('/src/utils/color.ts')
const H = await server.ssrLoadModule('/src/utils/harmony.ts')
let fail = 0
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fail++ }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 1) HEX 정규화 (normalizeHex) ──
const validHex = [['#abc', '#AABBCC'], ['abc', '#AABBCC'], ['#ABCDEF', '#ABCDEF'], ['abcdef', '#ABCDEF'], ['  #4d7cfe  ', '#4D7CFE'], ['#000', '#000000'], ['FFF', '#FFFFFF']]
for (const [input, want] of validHex) check(`normalizeHex(${JSON.stringify(input)}) → ${want}`, C.normalizeHex(input) === want, C.normalizeHex(input))
const invalidHex = ['', '#', '#a', '#ab', '#abcd', '#abcde', '#abcdefa', '#ggg', '##abc', 'rgb(1,2,3)', '#12 345', '#-12345', '0x123456', '#ＡＢＣ']
check('normalizeHex: 잘못된 값 14종 → null', invalidHex.every((v) => C.normalizeHex(v) === null), invalidHex.filter((v) => C.normalizeHex(v) !== null).join(','))

// ── 2) HEX 입력 검증 (validateHexInput, hasInvalidHexChars) ──
check('검증: 올바른 값 → null', ['#4D7CFE', '4d7cfe', '#FA0', 'fa0', ' #fa0 '].every((v) => C.validateHexInput(v) === null))
check('검증: 빈 값·공백 → 입력 요청', C.validateHexInput('')?.includes('입력해') && C.validateHexInput('   ')?.includes('입력해'))
check('검증: 허용되지 않는 문자 → 문자 안내', ['#GG0000', '#12345Z', 'red', '#12 34', '##123'].every((v) => C.validateHexInput(v)?.includes('0~9')))
check('검증: 자릿수 오류 → 자릿수 안내', ['#', '#1', '#12', '#1234', '#12345', '#1234567'].every((v) => C.validateHexInput(v)?.includes('6자리')))
check('hasInvalidHexChars: 입력 중(미완성)은 허용', !C.hasInvalidHexChars('') && !C.hasInvalidHexChars('#') && !C.hasInvalidHexChars('#4d') && C.hasInvalidHexChars('#4g') && C.hasInvalidHexChars('#4d#'))

// ── 3) HEX ↔ RGB ──
check('hexToRgb 기준값', same(C.hexToRgb('#4D7CFE'), { r: 77, g: 124, b: 254 }) && same(C.hexToRgb('fa0'), { r: 255, g: 170, b: 0 }))
check('hexToRgb 잘못된 값 → 검정(안전한 기본값)', same(C.hexToRgb('nope'), { r: 0, g: 0, b: 0 }))
check('rgbToHex 기준값·대문자·두 자리 채움', C.rgbToHex({ r: 1, g: 2, b: 3 }) === '#010203' && C.rgbToHex({ r: 171, g: 205, b: 239 }) === '#ABCDEF')
check('rgbToHex 반올림 (127.5 → 80)', C.rgbToHex({ r: 127.5, g: 127.4, b: 0.5 }) === '#807F01', C.rgbToHex({ r: 127.5, g: 127.4, b: 0.5 }))
check('rgbToHex 범위 밖 값 제한 (-5 → 0, 300 → 255)', C.rgbToHex({ r: -5, g: 300, b: 255.6 }) === '#00FFFF')
let rgbBad = null
for (let i = 0; i < 4096; i++) {
  const rgb = { r: (i * 37) % 256, g: (i * 101) % 256, b: (i * 211) % 256 }
  if (!same(C.hexToRgb(C.rgbToHex(rgb)), rgb)) { rgbBad = rgb; break }
}
check('RGB → HEX → RGB 왕복 4096색', rgbBad === null, JSON.stringify(rgbBad))

// ── 4) RGB ↔ HSL ──
const hslCases = [['#FF0000', { h: 0, s: 100, l: 50 }], ['#00FF00', { h: 120, s: 100, l: 50 }], ['#0000FF', { h: 240, s: 100, l: 50 }],
  ['#FFFF00', { h: 60, s: 100, l: 50 }], ['#FFFFFF', { h: 0, s: 0, l: 100 }], ['#000000', { h: 0, s: 0, l: 0 }], ['#808080', { h: 0, s: 0, l: 50 }], ['#336699', { h: 210, s: 50, l: 40 }]]
for (const [hex, hsl] of hslCases) check(`hexToHsl(${hex})`, same(C.hexToHsl(hex), hsl), JSON.stringify(C.hexToHsl(hex)))
check('hslToHex: 색상각 360 = 0, -120 = 240, 480 = 120', C.hslToHex({ h: 360, s: 100, l: 50 }) === '#FF0000' && C.hslToHex({ h: -120, s: 100, l: 50 }) === '#0000FF' && C.hslToHex({ h: 480, s: 100, l: 50 }) === '#00FF00')
check('hslToHex: 채도·밝기 범위 밖 값 제한', C.hslToHex({ h: 0, s: 150, l: 50 }) === '#FF0000' && C.hslToHex({ h: 0, s: 50, l: -10 }) === '#000000' && C.hslToHex({ h: 0, s: 50, l: 120 }) === '#FFFFFF')
check('hslToHex: 채도 0이면 색상각과 무관한 회색', C.hslToHex({ h: 0, s: 0, l: 50 }) === C.hslToHex({ h: 200, s: 0, l: 50 }))
let hslMax = 0
for (let i = 0; i < 4096; i++) {
  const rgb = { r: (i * 37) % 256, g: (i * 101) % 256, b: (i * 211) % 256 }
  const back = C.hslToRgb(C.rgbToHsl(rgb))
  hslMax = Math.max(hslMax, Math.abs(back.r - rgb.r), Math.abs(back.g - rgb.g), Math.abs(back.b - rgb.b))
}
// HSL은 정수(각도 1°, 1%)로 반올림해 표시하므로 채널당 약간의 오차가 생길 수 있습니다.
check('RGB → HSL(정수) → RGB 왕복 오차 ≤ 3', hslMax <= 3, `최대 오차 ${hslMax}`)

// ── 5) Lab · ΔE · 휘도 · 대비 ──
const labWhite = C.rgbToLab({ r: 255, g: 255, b: 255 })
const labRed = C.rgbToLab({ r: 255, g: 0, b: 0 })
check('rgbToLab 흰색 L=100, a=b=0', near(labWhite.l, 100, 0.01) && near(labWhite.a, 0, 0.01) && near(labWhite.b, 0, 0.01), JSON.stringify(labWhite))
check('rgbToLab 검정 L=0', near(C.rgbToLab({ r: 0, g: 0, b: 0 }).l, 0, 1e-9))
check('rgbToLab 빨강 (L 53.24, a 80.09, b 67.20)', near(labRed.l, 53.24, 0.05) && near(labRed.a, 80.09, 0.1) && near(labRed.b, 67.2, 0.1), JSON.stringify(labRed))
check('deltaE: 같은 색 0, 대칭', C.deltaE(labRed, labRed) === 0 && near(C.deltaE(labRed, labWhite), C.deltaE(labWhite, labRed), 1e-12))
check('상대 휘도: 흰 1, 검 0, 중간 회색 ≈ 0.2159', near(C.relativeLuminance('#FFFFFF'), 1, 1e-9) && C.relativeLuminance('#000000') === 0 && near(C.relativeLuminance('#808080'), 0.2159, 0.0005))
check('readableTextColor: 밝은 배경 → 검은 글자, 어두운 배경 → 흰 글자', C.readableTextColor('#FFD166') === '#111111' && C.readableTextColor('#1A1A40') === '#FFFFFF' && C.readableTextColor('#FFFFFF') === '#111111')

// ── 6) 배색 계산 경계값 보강 ──
// 기준 색상각이 0°/360° 바로 근처일 때
for (const targetHue of [0.5, 359.5, 180, 89.9]) {
  const base = H.oklchToHex({ l: 0.65, c: 0.12, h: targetHue })
  const bh = H.hexToOklch(base).h
  const res = Object.fromEntries(H.buildHarmonies(base).map((r) => [r.kind, r.colors.map((c) => c.hue)]))
  const ok = near(res.complementary[1], H.normalizeHue(bh + 180), 1e-9) &&
    near(res.analogous[0], H.normalizeHue(bh - 30), 1e-9) &&
    near(res.split[2], H.normalizeHue(bh + 210), 1e-9) &&
    Object.values(res).flat().every((h) => h >= 0 && h < 360)
  check(`배색: 기준 색상각 ≈${targetHue}°에서 각도 계산`, ok, `기준 ${bh.toFixed(2)}° → 보색 ${res.complementary[1].toFixed(2)}°, 유사색 ${res.analogous.map((h) => h.toFixed(1)).join('/')}`)
}
// 모든 규칙: 색 수, 각도 간격, 결과가 화면 표현 범위 안
const rules = Object.fromEntries(H.HARMONY_RULES.map((r) => [r.kind, r.offsets]))
check('배색 규칙 각도 정의', same(rules, { analogous: [-30, 0, 30], complementary: [0, 180], split: [0, 150, 210], triadic: [0, 120, 240] }))
let gamutBad = null
for (let i = 0; i < 500 && !gamutBad; i++) {
  const hex = C.rgbToHex({ r: (i * 53) % 256, g: (i * 97) % 256, b: (i * 151) % 256 })
  for (const r of H.buildHarmonies(hex)) {
    for (const c of r.colors) {
      if (!/^#[0-9A-F]{6}$/.test(c.hex) || !H.isInSrgbGamut(H.hexToOklch(c.hex))) gamutBad = `${hex} ${r.kind} ${c.hex}`
    }
  }
}
check('배색: 500개 기준 색의 모든 추천 색이 올바른 HEX이며 표현 가능 범위 안', gamutBad === null, gamutBad ?? '')
// 극단적인 기준 색
for (const hex of ['#000000', '#FFFFFF', '#00FF00', '#0000FF', '#FFFF00']) {
  const all = H.buildHarmonies(hex).flatMap((r) => r.colors)
  check(`배색: 극단색 ${hex} 처리`, all.every((c) => /^#[0-9A-F]{6}$/.test(c.hex)) && all[1].hex !== undefined)
}
check('배색: 검정·흰색은 무채색 안내 대상, 순색은 아님', H.isAchromatic('#000000') && H.isAchromatic('#FFFFFF') && !H.isAchromatic('#00FF00'))
check('배색: 색역 보정 시 밝기 유지 (#00FF00 보색)', near(H.hexToOklch(H.buildHarmonies('#00FF00')[1].colors[1].hex).l, H.hexToOklch('#00FF00').l, 0.01))
check('배색: 소문자 기준 색도 대문자로 유지', H.buildHarmonies('#3366cc')[0].colors[1].hex === '#3366CC')

await server.close()
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
