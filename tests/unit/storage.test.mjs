import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true }, logLevel: 'error' })
const S = await server.ssrLoadModule('/src/utils/paletteStorage.ts')
const E = await server.ssrLoadModule('/src/utils/exportPalette.ts')

// 가짜 LocalStorage (용량 제한, 사용 불가 상태 흉내)
const store = new Map(); let quota = Infinity; let broken = false
globalThis.localStorage = {
  getItem: (k) => { if (broken) throw new DOMException('denied', 'SecurityError'); return store.has(k) ? store.get(k) : null },
  setItem: (k, v) => { if (broken) throw new DOMException('denied', 'SecurityError'); if (v.length > quota) throw new DOMException('full', 'QuotaExceededError'); store.set(k, String(v)) },
}
const KEY = 'palette-studio:palettes:v1'
let fail = 0
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fail++ }

const p = S.createPalette('봄 팔레트', ['#FF0000', '#00FF00'], [0.7, 0.3])
check('생성: 필수 필드 포함', p.id && p.name === '봄 팔레트' && p.colors.length === 2 && p.ratios[0] === 0.7 && p.createdAt === p.updatedAt && !isNaN(Date.parse(p.createdAt)))
check('빈 저장소 → 빈 목록', S.loadPalettes().palettes.length === 0 && S.loadPalettes().error === null)
check('저장 성공', S.savePalettes([p]) === null)
let r = S.loadPalettes()
check('저장 후 불러오기 일치', r.error === null && JSON.stringify(r.palettes[0]) === JSON.stringify(p))

// 손상 데이터
store.set(KEY, '{깨진 json')
r = S.loadPalettes()
check('손상된 JSON → 안내 + 백업', r.palettes.length === 0 && r.error?.includes('손상') && store.get('palette-studio:palettes:corrupted-backup') === '{깨진 json', r.error)
store.set(KEY, JSON.stringify({ not: 'array' }))
check('배열 아님 → 안내', S.loadPalettes().error !== null)
store.set(KEY, JSON.stringify([p, { ...p, id: 'x', colors: ['#GG0000', '#000'] }, { ...p, id: 'y', ratios: [0.5] }, { ...p, id: 'z', createdAt: 'yesterday' }, { ...p, id: 'w', ratios: [2, 0] }, null]))
r = S.loadPalettes()
check('잘못된 항목만 제외', r.palettes.length === 1 && r.error?.includes('5개'), r.error)
check('3자리 HEX 정규화', S.parsePalette({ ...p, colors: ['#abc', 'ff0000'] })?.colors.join() === '#AABBCC,#FF0000')

// 저장 공간 부족 / 저장소 사용 불가
quota = 50
const qErr = S.savePalettes([p, p, p])
check('용량 부족 → 안내', qErr?.includes('저장 공간이 부족'), qErr)
quota = Infinity; broken = true
check('저장소 사용 불가(읽기) → 안내', S.loadPalettes().error?.includes('사용할 수 없습니다'))
check('저장소 사용 불가(쓰기) → 안내', S.savePalettes([p]) !== null)
broken = false

// JSON 내보내기 / 가져오기
const json = S.palettesToJson([p])
check('내보내기 형식 표시', JSON.parse(json).format === 'palette-studio' && JSON.parse(json).version === 1)
check('내보낸 JSON 다시 가져오기', JSON.stringify(S.parseImportedJson(json)) === JSON.stringify([p]))
check('배열 형식 가져오기', S.parseImportedJson(JSON.stringify([p, p])).length === 2)
check('단일 객체 가져오기', S.parseImportedJson(JSON.stringify(p)).length === 1)
const throws = (fn) => { try { fn(); return null } catch (e) { return e instanceof S.PaletteDataError ? e.message : 'WRONG ' + e } }
check('JSON 아님 → 오류', throws(() => S.parseImportedJson('hello'))?.includes('JSON'), throws(() => S.parseImportedJson('hello')))
check('팔레트 없음 → 오류', throws(() => S.parseImportedJson('{"palettes":[{"id":1}]}')) !== null)
check('숫자 JSON → 오류', throws(() => S.parseImportedJson('42')) !== null)

// 파일 이름
check('파일 이름 정리', E.toFileName(' 봄/여름: 팔레트? ') === '봄-여름-팔레트' && E.toFileName('   ') === 'palette', E.toFileName(' 봄/여름: 팔레트? '))

await server.close()
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과')
process.exit(fail ? 1 : 0)
