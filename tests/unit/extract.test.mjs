import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true }, logLevel: 'error' })
const { buildPalette, validateImageFile } = await server.ssrLoadModule('/src/utils/extractColors.ts')
const { rgbToLab, deltaE, hexToRgb } = await server.ssrLoadModule('/src/utils/color.ts')
let fail = 0
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fail++ }
const fill = (arr, rgb, n) => { for (let i = 0; i < n; i++) arr.push([...rgb]) }
const sum = (p) => p.reduce((s, c) => s + c.ratio, 0)
const minDE = (p) => { let m = Infinity; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) m = Math.min(m, deltaE(rgbToLab(hexToRgb(p[i].hex)), rgbToLab(hexToRgb(p[j].hex)))); return m }

// 1) 거의 같은 빨강 두 개 → 하나로 합쳐져야 함
let px = []; fill(px, [255,0,0], 4000); fill(px, [248,6,6], 2000); fill(px, [0,0,255], 2000); fill(px, [0,200,0], 1000); fill(px, [255,230,0], 1000)
let p = buildPalette(px, 5)
check('유사 빨강 중복 제거', p.length === 4, p.map(c => `${c.hex} ${(c.ratio*100).toFixed(1)}%`).join(', '))
check('빨강 비율 ≈ 60%', Math.abs(p[0].ratio - 0.6) < 0.01)
check('비율 합계 100%', Math.abs(sum(p) - 1) < 1e-9)

// 2) 다양한 색 그라데이션 → 요청한 개수, 서로 충분히 다름
for (const n of [5, 6, 8, 10]) {
  px = []
  for (let x = 0; x < 200; x++) for (let y = 0; y < 150; y++) px.push([Math.round(x * 1.27), Math.round(y * 1.7), 255 - Math.round(x * 0.6)])
  p = buildPalette(px, n)
  check(`그라데이션 ${n}개 요청`, p.length === n && Math.abs(sum(p) - 1) < 1e-9 && p.every((c, i) => i === 0 || p[i-1].ratio >= c.ratio), `→ ${p.length}개, 최소 ΔE ${minDE(p).toFixed(1)}`)
  check(`  RGB 값과 HEX 일치`, p.every(c => JSON.stringify(hexToRgb(c.hex)) === JSON.stringify(c.rgb)))
}

// 3) 단색 이미지 → 1개, 100%
px = []; fill(px, [12,34,56], 500)
p = buildPalette(px, 8)
check('단색 이미지', p.length === 1 && p[0].hex === '#0C2238' && p[0].ratio === 1, JSON.stringify(p))

// 4) 빈 픽셀
check('빈 픽셀 → 빈 결과', buildPalette([], 5).length === 0)

// 5) 파일 검사
const f = (name, type, size) => new File([new Uint8Array(size)], name, { type })
check('JPG 허용', validateImageFile(f('a.jpg', 'image/jpeg', 10)) === null)
check('PNG 허용', validateImageFile(f('a.png', 'image/png', 10)) === null)
check('WebP 허용', validateImageFile(f('a.webp', 'image/webp', 10)) === null)
check('type 없는 .jpeg 허용', validateImageFile(f('a.jpeg', '', 10)) === null)
check('GIF 거부', validateImageFile(f('a.gif', 'image/gif', 10)) !== null)
check('PDF 거부', validateImageFile(f('a.pdf', 'application/pdf', 10)) !== null)
check('빈 파일 거부', validateImageFile(f('a.png', 'image/png', 0)) !== null)
check('20MB 초과 거부', validateImageFile(f('a.png', 'image/png', 21 * 1024 * 1024)) !== null, validateImageFile(f('a.png', 'image/png', 21 * 1024 * 1024)))

// 6) 성능: 최대 분석 크기(200×200)
px = []; for (let i = 0; i < 40000; i++) px.push([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256])
const t = performance.now(); buildPalette(px, 10)
const ms = performance.now() - t
check('4만 픽셀 처리 시간', ms < 500, `${ms.toFixed(0)}ms`)

await server.close()
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
