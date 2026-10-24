// 실제 Chrome(또는 Edge)을 화면 없이(headless) 실행해 앱을 테스트합니다.
//
// 단계(phase)
//   main    : 새 프로필에서 전체 기능을 사용하고 데이터를 저장
//   reload  : 같은 프로필로 브라우저를 다시 켜서 데이터가 유지되는지 확인 (앱 재실행)
//   mobile  : 같은 프로필, 390×844 창에서 모바일 레이아웃 확인
//   broken  : 새 프로필에서 저장소가 고장 난 상황 흉내 → 앱이 멈추지 않는지 확인
// 마지막으로 데스크톱/모바일 스크린샷을 저장합니다.
//
// 사용법: npm run test:browser   (Chrome 경로가 다르면 CHROME_PATH 환경 변수로 지정)

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PORT = Number(process.env.TEST_PORT ?? 5191)
const PHASE_TIMEOUT_MS = 120_000

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!CHROME) {
  console.error('Chrome 또는 Edge를 찾지 못했습니다. CHROME_PATH 환경 변수로 브라우저 경로를 지정해 주세요.')
  process.exit(1)
}

// 브라우저가 결과를 보내면 해당 단계의 Promise를 끝냅니다.
let resolvePhase = () => {}
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { port: PORT, strictPort: true },
  plugins: [
    {
      name: 'palette-studio-test-harness',
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith('/__test.html')) {
            const html = await s.transformIndexHtml(
              req.url,
              '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
                '<body><div id="root"></div><script type="module" src="/tests/browser/app.test.js"></script></body></html>',
            )
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
            return
          }
          // 모바일 스크린샷용: 휴대폰 폭의 iframe에 실제 앱을 띄웁니다.
          if (req.url?.startsWith('/__frame.html')) {
            const w = new URL(req.url, 'http://x').searchParams.get('w') ?? '390'
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(`<!doctype html><body style="margin:0;background:#888"><iframe src="/" style="width:${w}px;height:844px;border:0;background:#fff"></iframe></body>`)
            return
          }
          if (req.url === '/__result' && req.method === 'POST') {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
              res.end('ok')
              resolvePhase(JSON.parse(body))
            })
            return
          }
          next()
        })
      },
    },
  ],
})
await server.listen()

const workDir = mkdtempSync(join(tmpdir(), 'palette-studio-test-'))
const profileA = join(workDir, 'profile-a')
const profileB = join(workDir, 'profile-b')

function launch(profile, url, size, extra = []) {
  return spawn(
    CHROME,
    // --hide-scrollbars: 휴대폰처럼 스크롤바가 화면 폭을 차지하지 않게 합니다.
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
      `--user-data-dir=${profile}`, `--window-size=${size}`, ...extra, url],
    { stdio: 'ignore' },
  )
}

async function runPhase(phase, profile, size, params = {}) {
  const query = new URLSearchParams({ phase, ...params }).toString()
  const done = new Promise((resolve) => (resolvePhase = resolve))
  const chrome = launch(profile, `http://localhost:${PORT}/__test.html?${query}`, size)
  const timer = setTimeout(() => resolvePhase({ results: [], fatal: `시간 초과 (${PHASE_TIMEOUT_MS / 1000}초)` }), PHASE_TIMEOUT_MS)
  const result = await done
  clearTimeout(timer)
  // Chrome은 LocalStorage 변경을 몇 초 뒤에 디스크에 씁니다. 강제 종료 전에 기다려야
  // 다음 단계(재실행)에서 정확히 확인할 수 있습니다. (사용자가 창을 정상 종료하면 즉시 저장됨)
  await new Promise((r) => setTimeout(r, 7000))
  chrome.kill()
  // 브라우저가 프로필 파일을 완전히 닫을 때까지 기다립니다.
  await new Promise((r) => chrome.once('exit', r).once('error', r))
  await new Promise((r) => setTimeout(r, 500))
  return result
}

async function screenshot(profile, size, file, path = '/') {
  const chrome = launch(profile, `http://localhost:${PORT}${path}`, size, [`--screenshot=${file}`, '--virtual-time-budget=4000'])
  await new Promise((r) => chrome.once('exit', r).once('error', r))
}

let totalFail = 0
let total = 0
function report(title, { results = [], logs = [], fatal }) {
  console.log(`\n━━ ${title} ━━`)
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  ' + r.info : ''}`)
    if (!r.ok) totalFail++
  }
  total += results.length
  if (logs.length) {
    console.log('[브라우저 콘솔 오류]\n  ' + logs.join('\n  '))
    totalFail++
  }
  if (fatal) {
    console.log('FATAL: ' + fatal)
    totalFail++
  }
}

const main = await runPhase('main', profileA, '1400,900')
report('1. 데스크톱 전체 기능 (main)', main)
report('2. 앱 재실행 후 데이터 유지 (reload)', await runPhase('reload', profileA, '1400,900', { expect: JSON.stringify(main.expect ?? {}) }))
report('3. 모바일 레이아웃 390×844 (mobile)', await runPhase('mobile', profileA, '800,900'))
report('4. 저장소 고장 상황 (broken)', await runPhase('broken', profileB, '1400,900'))

const shots = [join(workDir, 'desktop.png'), join(workDir, 'mobile.png')]
await screenshot(profileA, '1400,900', shots[0])
await screenshot(profileA, '400,850', shots[1], '/__frame.html?w=390')
console.log(`\n스크린샷: ${shots.join('  ')}`)

await server.close()
if (!process.env.KEEP_TEST_PROFILE) {
  // 스크린샷은 남기고 브라우저 프로필만 지웁니다.
  rmSync(profileA, { recursive: true, force: true })
  rmSync(profileB, { recursive: true, force: true })
}
console.log(totalFail ? `\n브라우저 테스트: ${totalFail}건 실패 / ${total}개` : `\n브라우저 테스트: 모두 통과 (${total}개)`)
process.exit(totalFail ? 1 : 0)
