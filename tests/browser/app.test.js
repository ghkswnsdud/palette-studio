// 브라우저 안에서 실행되는 검수 테스트입니다. tests/browser/run.mjs가 단계별로 실행합니다.
import '/src/index.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '/src/App.tsx'
import { deltaE, hexToRgb, rgbToHex, rgbToLab } from '/src/utils/color.ts'
import { extractPalette, ImageError, loadImage, validateImageFile } from '/src/utils/extractColors.ts'
import { prepareImage } from '/src/utils/moodboardImage.ts'
import { deleteProject, getImage, listProjects, saveImage, saveProject } from '/src/utils/moodboardDb.ts'
import { renderMoodboardPng } from '/src/utils/exportMoodboard.ts'
import { createPalette, loadPalettes, savePalettes } from '/src/utils/paletteStorage.ts'

const params = new URLSearchParams(location.search)
const phase = params.get('phase') ?? 'main'

// ───────────── 결과 기록 · 공통 도구 ─────────────
const results = []
const logs = []
const origConsoleError = console.error
console.error = (...a) => {
  logs.push(a.map(String).join(' ').slice(0, 300))
  origConsoleError(...a)
}
window.addEventListener('error', (e) => logs.push('window.error: ' + e.message + ' ' + String(e.error?.stack ?? '').slice(0, 300)))
window.addEventListener('unhandledrejection', (e) => logs.push('unhandledrejection: ' + (e.reason?.message ?? e.reason)))

// 네트워크 감시: 앱이 외부로 데이터를 보내는지 기록합니다. (/__result는 테스트 결과 전송용)
const network = []
const origFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.endsWith('/__result')) network.push(`fetch ${init?.method ?? 'GET'} ${url.slice(0, 80)}`)
  return origFetch(input, init)
}
const origXhrOpen = XMLHttpRequest.prototype.open
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  network.push(`xhr ${method} ${url}`)
  return origXhrOpen.call(this, method, url, ...rest)
}
const origBeacon = navigator.sendBeacon?.bind(navigator)
navigator.sendBeacon = (url, data) => {
  network.push(`beacon ${url}`)
  return origBeacon ? origBeacon(url, data) : false
}

const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info: String(info ?? '') })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeout = 8000) {
  const start = performance.now()
  while (performance.now() - start < timeout) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      // 조건이 아직 만족되지 않았으면 다시 시도합니다.
    }
    await sleep(50)
  }
  return null
}
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    check(name, false, 'EXCEPTION ' + String(e?.stack ?? e).slice(0, 400))
  }
}
const dE = (a, b) => deltaE(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)))
const $ = (sel, scope = document) => scope.querySelector(sel)
const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)]
const btn = (text, scope = document) => $$('button', scope).find((b) => b.textContent.trim() === text)
const setValue = (el, value) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const setFiles = (input, files) => {
  const dt = new DataTransfer()
  files.forEach((f) => dt.items.add(f))
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const pointer = (el, type, x, y, id = 7) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: id, clientX: x, clientY: y }))

function idb(store, mode, work) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('palette-studio')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(store, mode)
      const r = work(tx.objectStore(store))
      tx.oncomplete = () => {
        db.close()
        resolve(r?.result)
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}
const idbAll = (store) => idb(store, 'readonly', (s) => s.getAll())
const projectsInDb = async () => (await idbAll('projects')).sort((a, b) => a.createdAt.localeCompare(b.createdAt))

// 화면 상태 읽기
const swatchHexes = () => $$('.swatch-row').map((r) => $('.code-copy', r).textContent)
const swatchRatios = () => $$('.swatch-row').map((r) => {
  const t = $('.swatch-ratio span', r)?.textContent ?? ''
  return t.endsWith('%') ? parseFloat(t) / 100 : 0
})
const libraryNames = () => $$('.library-meta strong').map((s) => s.textContent)
const libraryCard = (name) => $$('.library-card').find((c) => $('.library-meta strong', c).textContent === name)
const errorTexts = () => $$('.upload-error').map((e) => e.textContent).join(' | ')
const toastText = () => $('.toast.is-visible')?.textContent ?? ''
const boardError = () => $('.board-error')?.textContent ?? ''
const imageFileInput = () => $('input[type=file]:not([multiple]):not([accept*="json"])')
const boardFileInput = () => $('input[type=file][multiple]')
const jsonInput = () => $('input[type=file][accept*="json"]')

// 다운로드 가로채기: <a download>.click() 대신 파일 내용을 기록합니다.
const downloads = []
HTMLAnchorElement.prototype.click = function () {
  if (this.download) downloads.push({ name: this.download, blob: origFetch(this.href).then((r) => r.blob()) })
}
/** trigger를 실행한 뒤 새로 생긴 다운로드를 기다립니다. (다운로드가 즉시 일어나도 놓치지 않도록 개수를 먼저 셉니다) */
async function nextDownload(trigger, predicate, timeout = 10000) {
  const before = downloads.length
  trigger()
  const d = await waitFor(() => downloads.slice(before).find((x) => predicate(x.name)), timeout)
  return d ? { name: d.name, blob: await d.blob } : null
}

// 클립보드 가로채기
const copied = []
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void copied.push(t) } })

// ───────────── 테스트 이미지 만들기 ─────────────
function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'))
  return c
}
const blobOf = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q))
async function fileOf(canvas, type, name, q) {
  return new File([await blobOf(canvas, type, q)], name, { type })
}
async function pixelAt(blob, x, y) {
  const bmp = await createImageBitmap(blob)
  const c = makeCanvas(bmp.width, bmp.height, (ctx) => ctx.drawImage(bmp, 0, 0))
  const [r, g, b] = c.getContext('2d').getImageData(x, y, 1, 1).data
  return { hex: rgbToHex({ r, g, b }), width: bmp.width, height: bmp.height }
}
// 400x300을 네 영역으로 칠함 → 비율 50%, 25%, 16.7%, 8.3%
const QUADS = [['#E63946', 0, 0, 200, 300], ['#1D3557', 200, 0, 200, 150], ['#F1C453', 200, 150, 200, 100], ['#2A9D8F', 200, 250, 200, 50]]
const EXPECT = [['#E63946', 0.5], ['#1D3557', 0.25], ['#F1C453', 1 / 6], ['#2A9D8F', 1 / 12]]
const quadCanvas = () => makeCanvas(400, 300, (ctx) => QUADS.forEach(([hex, x, y, w, h]) => { ctx.fillStyle = hex; ctx.fillRect(x, y, w, h) }))
const rainbowCanvas = () => makeCanvas(400, 300, (ctx) => {
  for (let x = 0; x < 400; x += 4) for (let y = 0; y < 300; y += 4) {
    ctx.fillStyle = `hsl(${(x / 400) * 360}, 80%, ${25 + (y / 300) * 50}%)`
    ctx.fillRect(x, y, 4, 4)
  }
})
const pngFile = await fileOf(quadCanvas(), 'image/png', 'quads.png')
const blueJpg = await fileOf(makeCanvas(300, 200, (ctx) => { ctx.fillStyle = '#2255CC'; ctx.fillRect(0, 0, 300, 200) }), 'image/jpeg', 'blue.jpg', 0.9)

function mountApp() {
  createRoot(document.getElementById('root')).render(createElement(App))
  return waitFor(() => $$('.project-select option').length > 0 || boardError(), 10000)
}

function checkNetwork() {
  const external = performance.getEntriesByType('resource').filter((e) => new URL(e.name).origin !== location.origin)
  check('보안: 앱이 fetch/XHR/beacon으로 데이터를 보내지 않음', network.length === 0, network.join(', '))
  check('보안: 외부 서버 요청 0건 (모든 요청이 같은 출처)', external.length === 0, external.map((e) => e.name).join(', '))
}

// ═════════════════════════════ main ═════════════════════════════
async function phaseMain() {
  await mountApp()

  await step('초기 프로젝트', async () => {
    await sleep(300)
    const count = (await idbAll('projects')).length
    check('화면: 첫 실행 시 기본 무드보드 1개만 생성', count === 1 && $$('.project-select option')[0].textContent.includes('내 첫 무드보드'), `${count}개`)
    check('화면: 빈 팔레트 안내 표시', $('.empty-hint')?.textContent.includes('이미지를 올리면'))
  })

  // ── 업로드 · 추출 ──
  await step('업로드', async () => {
    setFiles(imageFileInput(), [pngFile])
    const ok = await waitFor(() => $$('.swatch-row').length >= 4)
    check('추출: 업로드 → 팔레트 표시, 대표 색 정확', ok && dE(swatchHexes()[0], '#E63946') < 3, swatchHexes().join(' '))
    check('추출: 비율 표시 (50/25/16.7/8.3%)', swatchRatios().slice(0, 4).every((r, i) => Math.abs(r - EXPECT[i][1]) < 0.01), swatchRatios().join(','))
    check('추출: 미리보기·파일 정보 표시', $('.dropzone-preview')?.src.startsWith('blob:') && $('.file-name')?.textContent.includes('400×300'))
    check('추출: 단순한 이미지는 안내 토스트', toastText().includes('4개만'), toastText())
  })

  await step('잘못된 파일 업로드', async () => {
    setFiles(imageFileInput(), [new File(['hello'], 'note.txt', { type: 'text/plain' })])
    const err = await waitFor(() => errorTexts().includes('JPG, JPEG, PNG, WebP'))
    setFiles(imageFileInput(), [new File([crypto.getRandomValues(new Uint8Array(500))], 'broken.png', { type: 'image/png' })])
    const err2 = await waitFor(() => errorTexts().includes('손상'))
    check('추출: 잘못된 형식·손상 파일 → 안내, 기존 팔레트 유지', err && err2 && swatchHexes().length >= 4, errorTexts())
  })

  await step('색상 수 · 다시 추출', async () => {
    setFiles(imageFileInput(), [await fileOf(rainbowCanvas(), 'image/png', 'rainbow.png')])
    await waitFor(() => $('.file-name')?.textContent.includes('rainbow'))
    const counts = {}
    for (const n of ['5', '6', '8', '10']) {
      btn(n, $('.segmented')).click()
      await waitFor(() => $$('.swatch-row').length === Number(n))
      counts[n] = $$('.swatch-row').length
    }
    check('버튼: 색상 수 5/6/8/10 선택', Object.entries(counts).every(([n, c]) => Number(n) === c), JSON.stringify(counts))
    const before = swatchHexes().join()
    btn('다시 추출하기').click()
    await sleep(300)
    check('버튼: 다시 추출하기 (같은 결과)', swatchHexes().join() === before)
    const minDE = Math.min(...swatchHexes().flatMap((a, i, arr) => arr.slice(i + 1).map((b) => dE(a, b))))
    check('추출: 10색 중 비슷한 색 중복 없음 (최소 ΔE ≥ 5)', minDE >= 5, minDE.toFixed(1))
  })

  // ── 팔레트 편집 버튼 ──
  await step('팔레트 편집 버튼', async () => {
    setFiles(imageFileInput(), [pngFile])
    await waitFor(() => $('.file-name')?.textContent.includes('quads') && $$('.swatch-row').length === 4)
    const n = $$('.swatch-row').length
    btn('+ 색 추가').click()
    await waitFor(() => $$('.swatch-row').length === n + 1)
    check('버튼: + 색 추가 (직접 추가 표시)', $$('.swatch-row').length === n + 1 && $$('.swatch-row').at(-1).textContent.includes('직접 추가'))
    btn('팔레트에서 삭제').click()
    await waitFor(() => $$('.swatch-row').length === n)
    check('버튼: 팔레트에서 삭제', $$('.swatch-row').length === n)

    // 두 번째 색을 앞으로 옮기면 비율도 함께 움직여야 합니다.
    const [h0, h1] = swatchHexes()
    const [r0, r1] = swatchRatios()
    $$('.swatch-row')[1].click()
    await waitFor(() => $('.order-row strong')?.textContent === '2')
    btn('↑ 앞으로').click()
    await waitFor(() => swatchHexes()[0] === h1)
    check('버튼: 순서 ↑ 앞으로 (비율도 함께 이동)', swatchHexes()[0] === h1 && swatchHexes()[1] === h0 && swatchRatios()[0] === r1 && swatchRatios()[1] === r0)
    btn('↓ 뒤로').click()
    await waitFor(() => swatchHexes()[0] === h0)
    check('버튼: 순서 ↓ 뒤로', swatchHexes()[0] === h0)

    // 슬라이더 · 색상 선택기
    $$('.swatch-row')[0].click()
    await waitFor(() => $('.order-row strong')?.textContent === '1')
    setValue($$('.color-range')[0], '0')
    await waitFor(() => swatchHexes()[0].startsWith('#00'))
    check('버튼: RGB 슬라이더 → 팔레트 즉시 갱신', swatchHexes()[0].startsWith('#00'), swatchHexes()[0])
    setValue($('.editor-preview input[type=color]'), '#112233')
    await waitFor(() => swatchHexes()[0] === '#112233')
    check('버튼: 색상 선택기 → 팔레트 즉시 갱신', swatchHexes()[0] === '#112233')
    setValue($('.hex-input-row input'), '#ZZ')
    check('검증: 잘못된 HEX 문자 즉시 안내', (await waitFor(() => $('.field-error')?.textContent))?.includes('0~9'))
    setValue($('.hex-input-row input'), '#12')
    key($('.hex-input-row input'), 'Enter')
    check('검증: 미완성 HEX는 Enter 시 안내, 색 유지', (await waitFor(() => $('.field-error')?.textContent))?.includes('6자리') && swatchHexes()[0] === '#112233')
    key($('.hex-input-row input'), 'Escape')
    setValue($('.hex-input-row input'), '#FA0')
    key($('.hex-input-row input'), 'Enter')
    check('검증: 3자리 HEX(#FA0) → #FFAA00', (await waitFor(() => swatchHexes()[0] === '#FFAA00')) && $('.editor-preview code').textContent === '#FFAA00')
    setValue($('.hex-input-row input'), '#E63946')
    await waitFor(() => swatchHexes()[0] === '#E63946')
  })

  await step('복사', async () => {
    copied.length = 0
    $$('.code-copy')[0].click()
    $$('.code-copy')[1].click()
    btn('HEX 전체 복사').click()
    btn('복사', $('.hex-input-row')).click()
    await sleep(100)
    check('버튼: HEX·RGB 클릭 복사, 전체 복사, 편집 패널 복사',
      copied[0] === swatchHexes()[0] && /^rgb\(\d+, \d+, \d+\)$/.test(copied[1]) && copied[2] === swatchHexes().join(', ') && copied[3] === swatchHexes()[0],
      copied.join(' / '))
    check('버튼: 복사 후 토스트 표시', toastText().includes('복사됨'), toastText())
  })

  // ── 팔레트 저장 일관성 ──
  let saved
  await step('팔레트 저장', async () => {
    setValue($('.name-input'), '검수 팔레트')
    btn('저장', $('.sidebar-left')).click()
    await waitFor(() => loadPalettes().palettes.length === 1)
    saved = loadPalettes().palettes[0]
    check('저장: 이름·색·비율·시각이 화면과 일치',
      saved.name === '검수 팔레트' && saved.colors.join() === swatchHexes().join() &&
      saved.ratios.every((r, i) => Math.abs(r - swatchRatios()[i]) < 0.001) && saved.createdAt === saved.updatedAt && saved.id,
      JSON.stringify(saved))
    check('저장: 목록·미리보기 표시', libraryNames().includes('검수 팔레트') && $$('.library-strip span', libraryCard('검수 팔레트')).length === saved.colors.length)

    await sleep(20)
    setValue($('.hex-input-row input'), '#0A0B0C')
    await waitFor(() => swatchHexes()[0] === '#0A0B0C')
    btn('변경 사항 저장').click()
    await sleep(100)
    const updated = loadPalettes().palettes[0]
    check('저장: 변경 사항 저장 → 같은 id, 수정 시각만 갱신',
      updated.id === saved.id && updated.colors[0] === '#0A0B0C' && updated.createdAt === saved.createdAt && updated.updatedAt > saved.updatedAt && loadPalettes().palettes.length === 1)
    btn('새로 저장').click()
    await waitFor(() => loadPalettes().palettes.length === 2)
    const copy = loadPalettes().palettes[0]
    check('저장: 새로 저장 → 새 id', copy.id !== saved.id && copy.colors.join() === updated.colors.join())
    saved = updated
  })

  await step('불러오기 · 삭제', async () => {
    btn('삭제', $$('.library-card')[0]).click()
    ;(await waitFor(() => btn('삭제 확인'))).click()
    await waitFor(() => loadPalettes().palettes.length === 1)
    check('저장: 삭제(확인 단계) → 목록과 저장소에서 제거', loadPalettes().palettes.length === 1 && $$('.library-card').length === 1)
    // 이미지를 올리자마자(추출 진행 중) 저장된 팔레트를 불러옵니다.
    setFiles(imageFileInput(), [pngFile])
    await waitFor(() => $('.dropzone-overlay'), 2000)
    btn('불러오기', libraryCard('검수 팔레트')).click()
    await sleep(800)
    check('저장: 추출 중 불러오기 → 늦게 끝난 추출이 덮어쓰지 않음', swatchHexes()[0] === '#0A0B0C', swatchHexes().join(' '))
    check('저장: 불러오기 → 화면 = 저장 데이터', swatchHexes().join() === saved.colors.join() && $('.name-input').value === '검수 팔레트' && swatchRatios().every((r, i) => Math.abs(r - saved.ratios[i]) < 0.001))
  })

  // ── 배색 분석 ──
  await step('배색 분석', async () => {
    $$('.swatch-row')[1].click()
    btn('배색 분석').click()
    const cards = await waitFor(() => ($$('.harmony-card').length === 4 ? $$('.harmony-card') : null))
    check('배색: 추천 카드 4종', cards?.map((c) => $('h3', c).textContent).join() === '유사색,보색,분할 보색,삼색')
    check('배색: 기준 색 = 선택한 색', $('.analysis-base h3')?.textContent === swatchHexes()[1], `${$('.analysis-base h3')?.textContent} / ${swatchHexes()[1]}`)
    check('배색: 명도·채도 비교 행 = 팔레트 색 수', $$('.compare-row:not(.compare-head)').length === swatchHexes().length)
    check('배색: WCAG 대비표 (팔레트 + 흰/검)', $$('.contrast-matrix tbody tr').length === new Set([...swatchHexes(), '#FFFFFF', '#000000']).size)
    copied.length = 0
    $('.harmony-swatch', cards[1]).click()
    await sleep(50)
    check('배색: 추천 색 클릭 복사', copied[0] === $('.harmony-swatch code', cards[1]).textContent)
    const before = loadPalettes().palettes.length
    for (const card of cards) btn('새 팔레트로 저장', card).click()
    await sleep(100)
    const list = loadPalettes().palettes
    check('배색: 4종 모두 새 팔레트로 저장', list.length === before + 4 && list.slice(0, 4).map((p) => p.colors.length).join() === '3,3,2,3', list.slice(0, 4).map((p) => p.name).join(' / '))
    // 회색 기준 색
    btn('무드보드').click()
    $$('.swatch-row')[0].click()
    setValue($('.hex-input-row input'), '#808080')
    await waitFor(() => swatchHexes()[0] === '#808080')
    btn('배색 분석').click()
    check('배색: 무채색 기준 안내', (await waitFor(() => $('.analysis-notice')))?.textContent.includes('무채색'))
    btn('무드보드').click()
  })

  // ── JSON 내보내기 · 가져오기 ──
  await step('JSON 내보내기', async () => {
    const one = await nextDownload(() => btn('JSON 내보내기').click(), (n) => n.endsWith('.json'))
    const data = one && JSON.parse(await one.blob.text())
    check('JSON: 현재 팔레트 내보내기 (형식 표시·화면과 일치)', data?.format === 'palette-studio' && data.version === 1 && data.palettes[0].colors.join() === swatchHexes().join(), one?.name)
    const all = await nextDownload(() => btn('전체 내보내기').click(), (n) => n === 'palette-studio-palettes.json')
    const allData = all && JSON.parse(await all.blob.text())
    check('JSON: 전체 내보내기 = 저장 목록', allData?.palettes.length === loadPalettes().palettes.length)

    const before = loadPalettes().palettes
    setFiles(jsonInput(), [new File([await one.blob.text()], 'reimport.json', { type: 'application/json' })])
    await waitFor(() => loadPalettes().palettes.length === before.length + 1)
    const imported = loadPalettes().palettes[0]
    check('JSON: 내보낸 파일 다시 가져오기 (id 중복 시 새 id, 내용 동일)',
      imported.colors.join() === data.palettes[0].colors.join() && imported.name === data.palettes[0].name && !before.some((p) => p.id === imported.id && p.createdAt !== imported.createdAt))
  })

  await step('잘못된 JSON 가져오기', async () => {
    const valid = loadPalettes().palettes[0]
    const cases = [
      ['broken.json', '{ "palettes": [', 'JSON 형식'],
      ['empty.json', '', 'JSON 형식'],
      ['null.json', 'null', '찾을 수 없습니다'],
      ['shape.json', '{"palettes":[{"id":1}]}', '올바른 팔레트가 없습니다'],
      ['colors.json', JSON.stringify({ palettes: [{ ...valid, id: 'x1', colors: ['#GGGGGG'] }] }), '올바른 팔레트가 없습니다'],
      ['ratios.json', JSON.stringify([{ ...valid, id: 'x2', ratios: [5] }]), '올바른 팔레트가 없습니다'],
      ['big.json', 'x'.repeat(2.1 * 1024 * 1024), '2MB'],
    ]
    const count = loadPalettes().palettes.length
    const outcomes = []
    for (const [name, text, expected] of cases) {
      setFiles(jsonInput(), [new File([text], name, { type: 'application/json' })])
      const ok = await waitFor(() => errorTexts().includes(expected), 3000)
      outcomes.push(`${name}:${ok ? 'ok' : 'X'}`)
    }
    check('JSON: 잘못된 파일 7종 → 안내 메시지, 데이터 변화 없음', outcomes.every((o) => o.endsWith('ok')) && loadPalettes().palettes.length === count, outcomes.join(' '))
    btn('배색 분석').click()
    const alive = await waitFor(() => $$('.harmony-card').length === 4)
    btn('무드보드').click()
    check('JSON: 잘못된 파일 이후에도 앱 정상 동작', alive && (await waitFor(() => btn('메모 추가'))))
    setFiles(jsonInput(), [new File([JSON.stringify([{ ...valid, id: 'mixed-ok', name: '혼합 정상' }, { id: 'bad' }])], 'mixed.json')])
    await waitFor(() => loadPalettes().palettes.length === count + 1)
    check('JSON: 정상+비정상 혼합 → 정상 항목만 가져옴', loadPalettes().palettes[0].name === '혼합 정상' && loadPalettes().palettes.length === count + 1)
  })

  // ── 무드보드 ──
  await step('무드보드 요소 추가', async () => {
    btn('메모 추가').click()
    const note = await waitFor(() => $('.board-item-note textarea'))
    setValue(note, '테스트 메모')
    await sleep(700)
    check('무드보드: 메모 작성 → 자동 저장', (await projectsInDb())[0].items.some((i) => i.type === 'note' && i.text === '테스트 메모'))
    setFiles(boardFileInput(), [blueJpg])
    await waitFor(() => $$('.board-item-image img[src^="blob:"]').length === 1, 10000)
    btn('추출 이미지 넣기').click()
    await waitFor(() => $$('.board-item-image img[src^="blob:"]').length === 2, 10000)
    const images = await idbAll('images')
    check('무드보드: 참고 이미지·추출 이미지 추가 → IndexedDB Blob 저장', images.length === 2 && images.every((i) => i.blob instanceof Blob && i.blob.size > 0), images.map((i) => `${i.blob.type} ${i.blob.size}B`).join(', '))
    const savedPalette = loadPalettes().palettes.find((p) => p.name === '검수 팔레트')
    setValue($('select.palette-select'), savedPalette.id)
    await waitFor(() => $('.board-item-palette'))
    setValue($('select.palette-select'), '__current')
    await waitFor(() => $$('.board-item-palette').length === 2)
    check('무드보드: 저장된 팔레트·현재 팔레트 추가', $$('.board-palette-swatches span', $('.board-item-palette')).length === savedPalette.colors.length && $$('.board-item-palette').length === 2)
    $$('.swatch-row')[0].click()
    btn('무드보드에 추가').click()
    check('무드보드: 편집 패널 "무드보드에 추가"', await waitFor(() => $('.board-item-color')))
  })

  await step('끌어다 놓기 · 이동 · 크기', async () => {
    const board = $('.board')
    const rect = board.getBoundingClientRect()
    const dt = new DataTransfer()
    dt.setData('application/x-palette-hex', '#123456')
    board.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + 900, clientY: rect.top + 600 }))
    const chip = await waitFor(() => $$('.board-item-color').find((el) => el.textContent === '#123456'))
    check('무드보드: 팔레트 색 끌어다 놓기 (놓은 위치)', chip && chip.style.left === '840px' && chip.style.top === '540px', `${chip?.style.left},${chip?.style.top}`)
    const fileDt = new DataTransfer()
    fileDt.items.add(blueJpg)
    board.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: fileDt, clientX: rect.left + 300, clientY: rect.top + 700 }))
    check('무드보드: 이미지 파일 끌어다 놓기', await waitFor(() => $$('.board-item-image img[src^="blob:"]').length === 3, 10000))

    const r = chip.getBoundingClientRect()
    pointer(chip, 'pointerdown', r.left + 10, r.top + 10)
    pointer(chip, 'pointermove', r.left + 60, r.top + 40)
    pointer(chip, 'pointerup', r.left + 60, r.top + 40)
    const handle = $('.resize-handle', chip)
    const hr = handle.getBoundingClientRect()
    pointer(handle, 'pointerdown', hr.left + 2, hr.top + 2)
    pointer(handle, 'pointermove', hr.left + 42, hr.top + 22)
    pointer(handle, 'pointerup', hr.left + 42, hr.top + 22)
    await sleep(700)
    const item = (await projectsInDb())[0].items.find((i) => i.type === 'color' && i.hex === '#123456')
    check('무드보드: 끌어서 이동 + 크기 조절 → 저장', item?.x === 890 && item.y === 570 && item.w === 160 && item.h === 140, JSON.stringify(item))
    pointer(chip, 'pointerdown', 0, 0)
    pointer(chip, 'pointermove', -5000, -5000)
    pointer(chip, 'pointerup', -5000, -5000)
    await sleep(50)
    check('무드보드: 보드 밖으로 끌어도 경계 안에 유지', chip.style.left === '0px' && chip.style.top === '0px', `${chip.style.left},${chip.style.top}`)

    $('.board-item-note').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await waitFor(() => $('.board-item-note.is-selected'))
    btn('맨 뒤').click()
    await sleep(600)
    let items = (await projectsInDb())[0].items
    const noteIndex = () => items.findIndex((i) => i.type === 'note')
    check('무드보드: 맨 뒤', noteIndex() === 0)
    btn('앞으로').click()
    await sleep(600)
    items = (await projectsInDb())[0].items
    check('무드보드: 앞으로', noteIndex() === 1)
    btn('맨 앞').click()
    await sleep(600)
    items = (await projectsInDb())[0].items
    check('무드보드: 맨 앞', noteIndex() === items.length - 1)
    btn('뒤로').click()
    await sleep(600)
    items = (await projectsInDb())[0].items
    check('무드보드: 뒤로', noteIndex() === items.length - 2)
  })

  await step('무드보드 PNG', async () => {
    const d = await nextDownload(() => btn('PNG 내보내기', $('.workspace')).click(), (n) => n.endsWith('-moodboard.png'))
    const sig = d ? [...new Uint8Array(await d.blob.slice(0, 4).arrayBuffer())].join() : ''
    const px = d && (await pixelAt(d.blob, 10, 10))
    check('출력: 무드보드 PNG (파일 형식·배경)', sig === '137,80,78,71' && px.hex === '#F4F4F6' && px.width > 400, `${d?.name} ${px?.width}x${px?.height}`)
    const p = await nextDownload(() => btn('PNG 내보내기', $('.sidebar-left')).click(), (n) => n.endsWith('.png') && !n.endsWith('-moodboard.png'))
    const pp = p && (await pixelAt(p.blob, 120, 300))
    check('출력: 팔레트 PNG (2400×1248, 첫 색 픽셀)', pp?.width === 2400 && pp.height === 1248 && dE(pp.hex, swatchHexes()[0]) < 2, `${p?.name} ${pp?.hex} vs ${swatchHexes()[0]}`)
  })

  await step('프로젝트 관리 · 이미지 유실 방지', async () => {
    const first = (await projectsInDb())[0]
    const firstImageCount = $$('.board-item-image img[src^="blob:"]').length
    btn('새 프로젝트').click()
    await waitFor(() => $$('.project-select option').length === 2)
    btn('이름 변경').click()
    const input = await waitFor(() => $('.project-name-input'))
    setValue(input, '리네임 테스트')
    key(input, 'Enter')
    check('프로젝트: 생성 + 이름 변경', await waitFor(() => $$('.project-select option').some((o) => o.textContent.includes('리네임 테스트'))))
    check('프로젝트: 새 프로젝트는 빈 보드', $$('.board-item').length === 0)
    btn('이름 변경').click()
    const input2 = await waitFor(() => $('.project-name-input'))
    setValue(input2, '취소될 이름')
    key(input2, 'Escape')
    await sleep(100)
    check('프로젝트: 이름 변경 Esc 취소', !$$('.project-select option').some((o) => o.textContent.includes('취소될 이름')))

    // 이미지를 넣자마자(자동 저장 대기 중) 프로젝트를 바꿔도 유실되지 않아야 합니다.
    setFiles(boardFileInput(), [blueJpg])
    await waitFor(() => $('.board-item-image img[src^="blob:"]'), 10000)
    setValue($('.project-select'), first.id)
    await waitFor(() => $$('.board-item-image img[src^="blob:"]').length === firstImageCount, 10000)
    const second = (await projectsInDb()).find((p) => p.name === '리네임 테스트')
    check('유실 방지: 추가 직후 프로젝트 전환 → 이미지 저장됨', second?.items.filter((i) => i.type === 'image').length === 1)
    check('유실 방지: 원래 프로젝트로 돌아오면 이미지 모두 표시', $$('.board-item-image img[src^="blob:"]').length === firstImageCount)
    setValue($('.project-select'), second.id)
    check('유실 방지: 두 번째 프로젝트 이미지 표시', await waitFor(() => $$('.board-item-image img[src^="blob:"]').length === 1, 10000))

    btn('프로젝트 삭제').click()
    ;(await waitFor(() => btn('이미지까지 삭제 확인'))).click()
    await waitFor(() => $$('.project-select option').length === 1)
    await sleep(300)
    const images = await idbAll('images')
    check('프로젝트: 삭제 → 그 프로젝트 이미지만 삭제, 원래 프로젝트로 전환',
      !images.some((i) => i.projectId === second.id) && images.filter((i) => i.projectId === first.id).length === firstImageCount && $$('.board-item-image').length === firstImageCount)

    btn('새 프로젝트').click()
    await waitFor(() => $$('.project-select option').length === 2)
    setFiles(boardFileInput(), [blueJpg])
    await waitFor(() => $('.board-item-image img[src^="blob:"]'), 10000)
    btn('모두 지우기').click()
    ;(await waitFor(() => btn('모두 지우기 확인'))).click()
    await sleep(600)
    const third = (await projectsInDb()).at(-1)
    check('프로젝트: 모두 지우기 → 요소와 이미지 데이터 삭제', third.items.length === 0 && !(await idbAll('images')).some((i) => i.projectId === third.id))
    btn('이름 변경').click()
    const input3 = await waitFor(() => $('.project-name-input'))
    setValue(input3, '두 번째 보드')
    key(input3, 'Enter')
    btn('메모 추가').click()
    setValue(await waitFor(() => $('.board-item-note textarea')), '두 번째 보드 메모')
    setValue($('.project-select'), first.id)
    await waitFor(() => $$('.board-item-image').length === firstImageCount)
  })

  await step('요소 삭제 → 이미지 정리', async () => {
    const before = (await idbAll('images')).length
    const img = $('.board-item-image')
    const r = img.getBoundingClientRect()
    pointer(img, 'pointerdown', r.left + 5, r.top + 5)
    pointer(img, 'pointerup', r.left + 5, r.top + 5)
    await waitFor(() => $('.board-item-image.is-selected'))
    key(document.body, 'Delete')
    await sleep(500)
    check('무드보드: Delete 키 → 요소와 이미지 데이터 삭제', (await idbAll('images')).length === before - 1)
  })

  // ── 저장 실패 처리 ──
  await step('IndexedDB 저장 실패', async () => {
    const origPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    try {
    setValue($('.board-item-note textarea'), '저장 실패 테스트')
    const msg = await waitFor(() => boardError().includes('저장 공간이 부족'), 3000)
    const imgCount = $$('.board-item-image').length
    setFiles(boardFileInput(), [blueJpg])
    await waitFor(() => boardError().includes('blue.jpg'), 5000)
    check('저장 실패(IndexedDB): 용량 부족 안내, 앱 유지', msg && boardError().includes('저장 공간이 부족') && $$('.board-item-image').length === imgCount, boardError())
    } finally {
      IDBObjectStore.prototype.put = origPut
    }
    $('.board-error button').click()
    setValue($('.board-item-note textarea'), '복구 후 저장')
    await sleep(700)
    check('저장 실패(IndexedDB): 복구 후 정상 저장', !boardError() && (await projectsInDb())[0].items.some((i) => i.text === '복구 후 저장'))
  })

  await step('LocalStorage 저장 실패', async () => {
    const origSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith('palette-studio:palettes')) throw new DOMException('quota', 'QuotaExceededError')
      return origSet.call(this, k, v)
    }
    try {
      const before = JSON.stringify(loadPalettes().palettes)
      ;(btn('새로 저장') ?? btn('저장', $('.sidebar-left'))).click()
      const msg = await waitFor(() => errorTexts().includes('저장 공간이 부족'))
      check('저장 실패(LocalStorage): 용량 부족 안내, 기존 데이터·목록 유지', msg && JSON.stringify(loadPalettes().palettes) === before && $$('.library-card').length === loadPalettes().palettes.length)
    } finally {
      Storage.prototype.setItem = origSet
    }
    ;(btn('변경 사항 저장') ?? btn('저장', $('.sidebar-left'))).click()
    check('저장 실패(LocalStorage): 복구 후 저장 성공', await waitFor(() => !errorTexts().includes('저장 공간이 부족')))
  })

  // ── 실제 Canvas 추출 회귀 · 압축 · DB · PNG 픽셀 · 실제 용량 한도 ──
  await step('추출 회귀', async () => {
    for (const [label, type, tol] of [['PNG', 'image/png', 3], ['JPG', 'image/jpeg', 5], ['WebP', 'image/webp', 5]]) {
      const file = await fileOf(quadCanvas(), type, `q.${label}`, 0.95)
      const url = URL.createObjectURL(file)
      const colors = extractPalette(await loadImage(url), 5)
      URL.revokeObjectURL(url)
      const ok = EXPECT.every(([hex, ratio], i) => colors[i] && dE(colors[i].hex, hex) < tol && Math.abs(colors[i].ratio - ratio) < 0.03) && colors.slice(4).every((c) => c.ratio < 0.02)
      check(`추출(${label}): 대표 색·비율 정확`, ok && validateImageFile(file) === null, colors.map((c) => `${c.hex} ${(c.ratio * 100).toFixed(1)}%`).join(', '))
    }
    let err = null
    try {
      extractPalette(await loadImage(URL.createObjectURL(await fileOf(makeCanvas(50, 50, () => {}), 'image/png', 'c.png'))), 5)
    } catch (e) {
      err = e
    }
    check('추출: 완전 투명 이미지 → 안내 오류', err instanceof ImageError)
  })

  await step('이미지 압축', async () => {
    const big = await fileOf(makeCanvas(3000, 2000, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 3000, 2000)
      g.addColorStop(0, '#f00')
      g.addColorStop(1, '#00f')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 3000, 2000)
    }), 'image/png', 'big.png')
    const r = await prepareImage(big)
    check('압축: 3000×2000 → 1600×1067 WebP, 용량 감소', r.width === 1600 && r.height === 1067 && r.blob.type === 'image/webp' && r.blob.size < big.size, `${big.size}B → ${r.blob.size}B`)
    const s = await prepareImage(blueJpg)
    check('압축: 작은 이미지는 원본 크기, 용량 증가 없음', s.width === 300 && s.blob.size <= blueJpg.size)
  })

  await step('IndexedDB 직접 검사', async () => {
    const t = new Date().toISOString()
    await saveProject({ id: 'test-p1', name: 'P1', items: [], createdAt: t, updatedAt: t })
    await saveProject({ id: 'test-p2', name: 'P2', createdAt: t, updatedAt: t, items: [
      { id: 'i1', type: 'color', hex: '#abc', x: 1, y: 2, w: 3, h: 4 },
      { id: 'bad', type: 'color', hex: 'nope', x: 0, y: 0, w: 1, h: 1 },
      { id: 'bad2', type: 'unknown' },
    ] })
    const blob = new Blob([new Uint8Array(1234)], { type: 'image/webp' })
    for (const [id, projectId] of [['t-img1', 'test-p1'], ['t-img2', 'test-p1'], ['t-img3', 'test-p2']]) {
      await saveImage({ id, projectId, blob, width: 1, height: 1, createdAt: t })
    }
    check('IDB: Blob 저장/읽기', (await getImage('t-img1'))?.blob.size === 1234)
    await deleteProject('test-p1')
    check('IDB: 프로젝트 삭제 시 그 이미지만 삭제', !(await getImage('t-img1')) && !(await getImage('t-img2')) && !!(await getImage('t-img3')))
    await idb('projects', 'readwrite', (s) => s.put({ id: 'test-broken', foo: 1 }))
    const list = await listProjects()
    const p2 = list.find((p) => p.id === 'test-p2')
    check('IDB: 손상된 프로젝트 제외, 잘못된 요소만 제거', !list.some((p) => p.id === 'test-broken') && p2?.items.length === 1 && p2.items[0].hex === '#AABBCC')
    await deleteProject('test-p2')
    await deleteProject('test-broken')
  })

  await step('PNG 픽셀', async () => {
    const blueImg = await loadImage(URL.createObjectURL(blueJpg))
    const blob = await renderMoodboardPng([
      { id: 'a', type: 'color', hex: '#FF0000', x: 100, y: 100, w: 120, h: 120 },
      { id: 'b', type: 'palette', name: 'P', colors: ['#00FF00', '#0000FF'], x: 300, y: 100, w: 300, h: 140 },
      { id: 'c', type: 'image', imageId: 'img', x: 100, y: 300, w: 200, h: 100 },
      { id: 'd', type: 'note', text: '줄바꿈\n아주아주아주아주아주아주아주아주아주아주 긴 메모입니다', x: 400, y: 300, w: 200, h: 100 },
    ], new Map([['img', blueImg]]))
    const at = (x, y) => pixelAt(blob, (x - 60) * 2, (y - 60) * 2)
    const [red, green, blue, note] = [await at(160, 160), await at(375, 200), await at(200, 350), await at(590, 390)]
    check('출력: 무드보드 PNG 크기·요소 위치와 색', red.width === 1160 && red.height === 760 && red.hex === '#FF0000' && green.hex === '#00FF00' && dE(blue.hex, '#2255CC') < 3 && note.hex === '#FFF8C5', `${red.hex} ${green.hex} ${blue.hex} ${note.hex}`)
    let err = null
    try {
      await renderMoodboardPng([], new Map())
    } catch (e) {
      err = e
    }
    check('출력: 빈 무드보드는 내보내기 거부', !!err && btn('PNG 내보내기', $('.workspace')).disabled === false)
  })

  // ── 재실행 검사를 위한 기대값 기록 + 고아 이미지 심기 ──
  await sleep(800)
  const projects = await projectsInDb()
  const t = new Date().toISOString()
  await saveImage({ id: 'orphan-1', projectId: projects[0].id, blob: new Blob(['x']), width: 1, height: 1, createdAt: t })
  await saveImage({ id: 'orphan-2', projectId: 'no-such-project', blob: new Blob(['x']), width: 1, height: 1, createdAt: t })
  const expect = {
    palettes: loadPalettes().palettes.map((p) => ({ id: p.id, name: p.name, colors: p.colors, ratios: p.ratios, updatedAt: p.updatedAt })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, types: p.items.map((i) => i.type), imageIds: p.items.flatMap((i) => (i.type === 'image' ? [i.imageId] : [])), notes: p.items.flatMap((i) => (i.type === 'note' ? [i.text] : [])) })),
    currentProjectId: localStorage.getItem('palette-studio:current-project'),
  }
  check('재실행 준비: 데이터 기록', expect.projects.length === 2 && expect.palettes.length > 0, `팔레트 ${expect.palettes.length}개, 프로젝트 ${expect.projects.length}개, 이미지 ${expect.projects.flatMap((p) => p.imageIds).length}개`)
  checkNetwork()
  return { expect }
}

// ═════════════════════════════ reload ═════════════════════════════
async function phaseReload() {
  const expect = JSON.parse(params.get('expect') ?? '{}')
  await step('재실행: LocalStorage', async () => {
    const now = loadPalettes()
    const same = JSON.stringify(now.palettes.map((p) => ({ id: p.id, name: p.name, colors: p.colors, ratios: p.ratios, updatedAt: p.updatedAt }))) === JSON.stringify(expect.palettes)
    check('재실행: 저장된 팔레트 전부 유지 (id·이름·색·비율·시각)', same && now.error === null, `${now.palettes.length}개`)
  })
  await mountApp()
  await step('재실행: 화면', async () => {
    await waitFor(() => $$('.project-select option').length === expect.projects.length)
    check('재실행: 무드보드 프로젝트 목록 유지', $$('.project-select option').map((o) => o.textContent.replace(/ \(\d+\)$/, '')).join() === expect.projects.map((p) => p.name).join())
    check('재실행: 마지막으로 연 프로젝트 기억', $('.project-select').value === expect.currentProjectId)
    check('재실행: 저장 목록 화면 표시', libraryNames().join() === expect.palettes.map((p) => p.name).join())
    for (const p of expect.projects) {
      setValue($('.project-select'), p.id)
      const ok = await waitFor(() => $$('.board-item').length === p.types.length && $$('.board-item-image img[src^="blob:"]').length === p.imageIds.length, 10000)
      const notes = $$('.board-item-note textarea').map((t) => t.value)
      check(`재실행: '${p.name}' 요소·이미지·메모 유지 (이미지 ${p.imageIds.length}개)`, ok && notes.join() === p.notes.join(), `${$$('.board-item').length}개 요소, 메모 ${notes.join('/')}`)
    }
    const decoded = await Promise.all($$('.board-item-image img').map((img) => img.decode().then(() => img.naturalWidth > 0, () => false)))
    check('재실행: 이미지가 실제로 디코딩됨 (깨짐 없음)', decoded.every(Boolean))
  })
  await step('재실행: 고아 이미지 정리', async () => {
    const ids = (await idbAll('images')).map((i) => i.id)
    const used = expect.projects.flatMap((p) => p.imageIds)
    check('재실행: 연결 끊긴 이미지 자동 정리, 사용 중인 이미지 보존', !ids.includes('orphan-1') && !ids.includes('orphan-2') && used.every((id) => ids.includes(id)), `남은 ${ids.length}개 / 사용 ${used.length}개`)
  })
  checkNetwork()
  return {}
}

// ═════════════════════════════ mobile ═════════════════════════════
function layoutProblems(doc) {
  const win = doc.defaultView
  const vw = doc.documentElement.clientWidth
  const inScroll = (el) => el.closest('.workspace-scroll, .matrix-scroll')
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && win.getComputedStyle(el).visibility !== 'hidden'
  }
  const all = (sel) => [...doc.querySelectorAll(sel)]
  const els = all('button, input:not([type=file]):not([hidden]), select, textarea, h2, h3, p, .topbar, .main-tabs, .workspace-toolbar, .analysis-card')
    .filter((el) => visible(el) && !inScroll(el))
  return {
    vw,
    pageOverflow: doc.documentElement.scrollWidth - vw,
    outside: els
      .filter((el) => el.getBoundingClientRect().right > vw + 1 || el.getBoundingClientRect().left < -1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}:${el.textContent.trim().slice(0, 12)}`),
    smallInputs: all('input[type=text], input[type=number], select, textarea')
      .filter((el) => visible(el) && !inScroll(el) && parseFloat(win.getComputedStyle(el).fontSize) < 16)
      .map((el) => el.className || el.type),
    smallButtons: all('button')
      .filter((el) => visible(el) && !inScroll(el) && el.getBoundingClientRect().height < 32)
      .map((el) => el.textContent.trim().slice(0, 10) || el.getAttribute('aria-label')),
  }
}

async function phaseMobile() {
  // 실제 휴대폰 화면 폭(390×844)의 iframe에 앱(index.html)을 띄웁니다.
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:390px;height:844px;border:0;position:fixed;left:0;top:0'
  frame.src = '/'
  document.body.appendChild(frame)
  await new Promise((r) => (frame.onload = r))
  const doc = frame.contentDocument
  const q = (sel) => doc.querySelector(sel)
  const qa = (sel) => [...doc.querySelectorAll(sel)]
  const fbtn = (text) => qa('button').find((b) => b.textContent.trim() === text)
  await step('모바일 레이아웃', async () => {
    await waitFor(() => qa('.project-select option').length > 0, 10000)
    const a = layoutProblems(doc)
    check(`모바일: 화면 폭 ${a.vw}px에서 가로 스크롤 없음`, a.vw === 390 && a.pageOverflow <= 0, `넘침 ${a.pageOverflow}px`)
    check('모바일: 모든 버튼·입력·제목이 화면 안에 있음', a.outside.length === 0, a.outside.slice(0, 8).join(' | '))
    check('모바일: 입력칸 글자 16px 이상 (iOS 자동 확대 방지)', a.smallInputs.length === 0, [...new Set(a.smallInputs)].join(', '))
    check('모바일: 버튼 터치 높이 32px 이상', a.smallButtons.length === 0, [...new Set(a.smallButtons)].slice(0, 10).join(', '))
    setFiles(q('input[type=file]:not([multiple]):not([accept*="json"])'), [pngFile])
    check('모바일: 업로드·추출 동작', await waitFor(() => qa('.swatch-row').length >= 4))
    const b = layoutProblems(doc)
    check('모바일: 팔레트·편집 패널 표시 후에도 넘침·작은 버튼 없음', b.pageOverflow <= 0 && b.outside.length === 0 && b.smallButtons.length === 0, [...b.outside, ...b.smallButtons].slice(0, 8).join(' | '))
    fbtn('배색 분석').click()
    await waitFor(() => qa('.harmony-card').length === 4)
    const c = layoutProblems(doc)
    check('모바일: 배색 분석 화면 넘침 없음 (대비표는 가로 스크롤)', c.pageOverflow <= 0 && c.outside.length === 0, c.outside.slice(0, 8).join(' | '))
    fbtn('무드보드').click()
    const scroll = await waitFor(() => q('.workspace-scroll'))
    check('모바일: 무드보드는 내부 스크롤로 탐색', scroll && scroll.scrollWidth > scroll.clientWidth && frame.contentWindow.getComputedStyle(scroll).overflowX === 'auto')
  })
  checkNetwork()
  return {}
}

// ═════════════════════════════ broken ═════════════════════════════
async function phaseBroken() {
  await step('실제 LocalStorage 한도', async () => {
    const fillers = []
    for (const size of [1 << 20, 1 << 16, 1 << 12, 256, 16, 1]) {
      for (let i = 0; i < 64; i++) {
        const k = `__f${size}_${i}`
        try {
          localStorage.setItem(k, 'x'.repeat(size))
          fillers.push(k)
        } catch {
          break
        }
      }
    }
    const before = loadPalettes().palettes.length
    const err = savePalettes([createPalette('용량 테스트', ['#123456'], [1]), ...loadPalettes().palettes])
    check('저장 실패(LocalStorage 실제 한도): 안내 + 기존 데이터 유지', err?.includes('저장 공간이 부족') && loadPalettes().palettes.length === before, err)
    fillers.forEach((k) => localStorage.removeItem(k))
    check('저장 실패(LocalStorage 실제 한도): 공간 확보 후 저장 성공', savePalettes(loadPalettes().palettes) === null)
  })

  // 앱을 띄우기 전에 저장소를 고장 냅니다. (개인정보 보호 모드·저장소 차단 상황)
  Storage.prototype.getItem = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  Storage.prototype.setItem = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  IDBFactory.prototype.open = function () {
    const req = {}
    setTimeout(() => req.onerror?.(new Event('error')))
    return req
  }
  await mountApp()
  await step('저장소 고장', async () => {
    check('저장소 고장: 앱이 멈추지 않고 화면 표시', $('.topbar') && $('.dropzone'))
    check('저장소 고장: 팔레트 저장소 안내', await waitFor(() => errorTexts().includes('사용할 수 없습니다')), errorTexts())
    check('저장소 고장: 무드보드 저장소 안내 + 버튼 비활성화', (await waitFor(() => boardError().includes('열 수 없습니다'))) && btn('메모 추가').disabled, boardError())
    setFiles(imageFileInput(), [pngFile])
    check('저장소 고장: 이미지 업로드·추출은 정상', await waitFor(() => $$('.swatch-row').length >= 4))
    btn('저장', $('.sidebar-left')).click()
    check('저장소 고장: 저장 시 안내, 앱 유지', await waitFor(() => errorTexts().includes('저장하지 못했습니다')), errorTexts())
    btn('배색 분석').click()
    check('저장소 고장: 배색 분석 정상', await waitFor(() => $$('.harmony-card').length === 4))
  })
  checkNetwork()
  return {}
}

const phases = { main: phaseMain, reload: phaseReload, mobile: phaseMobile, broken: phaseBroken }
let extra = {}
let fatal = null
try {
  extra = await phases[phase]()
} catch (e) {
  fatal = String(e?.stack ?? e)
}
await origFetch('/__result', { method: 'POST', body: JSON.stringify({ results, logs, fatal, ...extra }) })
