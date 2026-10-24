import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true }, logLevel: 'error' })
const H = await server.ssrLoadModule('/src/utils/harmony.ts')
const C = await server.ssrLoadModule('/src/utils/color.ts')
let fail = 0
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fail++ }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e

// 1) 각도 정규화 경계값
const cases = [[0,0],[360,0],[720,0],[-360,0],[370,10],[-30,330],[-725,355],[359.5,359.5],[359.9999999999,0],[-0,0],[1e-12,1e-12],[NaN,0],[Infinity,0],[-Infinity,0]]
for (const [input, want] of cases) { const got = H.normalizeHue(input); check(`normalizeHue(${input})`, near(got, want) && got >= 0 && got < 360 && !Object.is(got, -0), `→ ${got}`) }
check('rotateHue(350, +30) = 20', near(H.rotateHue(350, 30), 20))
check('rotateHue(10, -30) = 340', near(H.rotateHue(10, -30), 340))
check('rotateHue(200, 210) = 50', near(H.rotateHue(200, 210), 50))
check('rotateHue(0, 240) = 240', near(H.rotateHue(0, 240), 240))
check('hueDistance(350, 10) = 20', near(H.hueDistance(350, 10), 20))
check('hueDistance(0, 180) = 180', near(H.hueDistance(0, 180), 180))
check('hueDistance(-90, 270) = 0', near(H.hueDistance(-90, 270), 0))

// 2) OKLCH 변환 기준값 (참고: 공식 자료의 sRGB red L=0.628 C=0.2577 h=29.23)
const red = H.hexToOklch('#FF0000')
check('빨강 OKLCH', near(red.l, 0.628, 0.001) && near(red.c, 0.2577, 0.001) && near(red.h, 29.23, 0.05), JSON.stringify(red))
const white = H.hexToOklch('#FFFFFF'), black = H.hexToOklch('#000000'), gray = H.hexToOklch('#808080')
check('흰색 L=1, 무채색', near(white.l, 1, 1e-3) && white.c < 1e-3 && white.h === 0)
check('검정 L=0, 무채색', near(black.l, 0, 1e-6) && black.c < 1e-6 && black.h === 0)
check('회색 무채색 판정', H.isAchromatic('#808080') && gray.h === 0 && !H.isAchromatic('#FF0000'))

// 3) 왕복 변환: 무작위 2000색 HEX → OKLCH → HEX 동일
let bad = null
for (let i = 0; i < 50000; i++) { const hex = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase(); if (H.oklchToHex(H.hexToOklch(hex)) !== hex) { bad = hex; break } }
check('HEX↔OKLCH 왕복 50000색', bad === null, bad ?? '')
for (const hex of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF']) check(`  경계색 왕복 ${hex}`, H.oklchToHex(H.hexToOklch(hex)) === hex)

// 4) 색역(gamut) 밖 색 처리
const outside = { l: 0.7, c: 0.4, h: 150 }
check('범위 밖 색 감지', !H.isInSrgbGamut(outside))
const mapped = H.hexToOklch(H.oklchToHex(outside))
check('범위 밖 → 채도만 줄이고 L·h 유지', near(mapped.l, 0.7, 0.01) && H.hueDistance(mapped.h, 150) < 2 && mapped.c < 0.4, JSON.stringify(mapped))
check('L 범위 밖(1.5, -1) 처리', H.oklchToHex({ l: 1.5, c: 0, h: 0 }) === '#FFFFFF' && H.oklchToHex({ l: -1, c: 0.2, h: 0 }) === '#000000')
check('음수 채도 처리', /^#[0-9A-F]{6}$/.test(H.oklchToHex({ l: 0.5, c: -0.1, h: 0 })))

// 5) 배색 규칙
const base = '#3366CC'; const bh = H.hexToOklch(base).h
const result = Object.fromEntries(H.buildHarmonies(base).map((r) => [r.kind, r]))
check('기준 색은 원래 HEX 유지', Object.values(result).every((r) => r.colors.find((c) => c.offset === 0).hex === base))
const expectHues = { analogous: [-30, 0, 30], complementary: [0, 180], split: [0, 150, 210], triadic: [0, 120, 240] }
for (const [kind, offs] of Object.entries(expectHues)) {
  const r = result[kind]
  const anglesOk = r.colors.length === offs.length && r.colors.every((c, i) => near(c.hue, H.normalizeHue(bh + offs[i]), 1e-9))
  // 실제 결과 색의 색상각도 검증 (반올림·색역 보정 오차 3° 허용)
  const actualOk = r.colors.every((c) => H.hueDistance(H.hexToOklch(c.hex).h, c.hue) < 3)
  check(`${r.label} 각도`, anglesOk && actualOk, r.colors.map((c) => `${c.hex}@${c.hue.toFixed(1)}°`).join(' '))
}
// 보색끼리 정확히 180°
const comp = result.complementary.colors
check('보색 각도 차 180°', near(H.hueDistance(comp[0].hue, comp[1].hue), 180, 1e-9))
// 경계: 기준 각도 350°대에서 유사색이 0°를 넘어가는지
const pinkish = H.oklchToHex({ l: 0.65, c: 0.15, h: 350 }); const ph = H.hexToOklch(pinkish).h
const an = H.buildHarmonies(pinkish).find((r) => r.kind === 'analogous').colors
check('0°/360° 경계 넘김 (유사색)', an.every((c) => c.hue >= 0 && c.hue < 360) && near(an[2].hue, H.normalizeHue(ph + 30), 1e-9), `base ${ph.toFixed(1)}° → ${an.map((c) => c.hue.toFixed(1)).join(', ')}`)
// 모든 결과는 올바른 HEX이고 밝기가 비슷하게 유지됨 (OKLCH 장점)
const all = H.buildHarmonies('#E07A5F').flatMap((r) => r.colors)
const ls = all.map((c) => H.hexToOklch(c.hex).l)
check('추천 색 밝기 유지 (ΔL < 0.02)', Math.max(...ls) - Math.min(...ls) < 0.02 && all.every((c) => /^#[0-9A-F]{6}$/.test(c.hex)), `L ${Math.min(...ls).toFixed(3)}~${Math.max(...ls).toFixed(3)}`)
// 비교: HSL로 같은 회전을 하면 밝기가 얼마나 흔들리는지 (참고 출력)
const hsl = C.hexToHsl('#E07A5F'); const hslLs = [0, 120, 180, 240].map((o) => H.hexToOklch(C.hslToHex({ ...hsl, h: (hsl.h + o) % 360 })).l)
console.log(`  참고: HSL 회전 시 지각 밝기 범위 ${Math.min(...hslLs).toFixed(3)}~${Math.max(...hslLs).toFixed(3)}`)
// 무채색 기준 색: 오류 없이 회색 결과
const grayRes = H.buildHarmonies('#808080').flatMap((r) => r.colors)
check('무채색 기준 → 오류 없이 처리', grayRes.every((c) => /^#[0-9A-F]{6}$/.test(c.hex)))

// 6) WCAG 대비율 경계
check('흰/검 21:1', near(C.contrastRatio('#FFFFFF', '#000000'), 21, 1e-9))
check('같은 색 1:1', near(C.contrastRatio('#3366CC', '#3366CC'), 1, 1e-9))
check('대비율 대칭', near(C.contrastRatio('#123456', '#ABCDEF'), C.contrastRatio('#ABCDEF', '#123456'), 1e-12))
check('#777 on white ≈ 4.48 (AA 미달 경계)', near(C.contrastRatio('#777777', '#FFFFFF'), 4.48, 0.01), C.contrastRatio('#777777', '#FFFFFF').toFixed(3))
check('#767676 on white ≥ 4.5 (AA 통과 경계)', C.contrastRatio('#767676', '#FFFFFF') >= 4.5, C.contrastRatio('#767676', '#FFFFFF').toFixed(3))
check('등급 경계', C.wcagGrade(7) === 'AAA' && C.wcagGrade(6.99) === 'AA' && C.wcagGrade(4.5) === 'AA' && C.wcagGrade(4.49) === 'AA 큰 글자' && C.wcagGrade(3) === 'AA 큰 글자' && C.wcagGrade(2.99) === '부족')

await server.close()
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
