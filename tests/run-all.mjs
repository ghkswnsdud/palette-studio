// 모든 테스트를 차례로 실행합니다.
//   node tests/run-all.mjs          → 단위 테스트 + 브라우저 테스트
//   node tests/run-all.mjs --unit   → 단위 테스트만 (Chrome 불필요)

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const unitOnly = process.argv.includes('--unit')

const suites = [
  ['단위: 색상 변환 · HEX 검증 · 배색 경계', 'tests/unit/color.test.mjs'],
  ['단위: 색상 추출', 'tests/unit/extract.test.mjs'],
  ['단위: 팔레트 저장', 'tests/unit/storage.test.mjs'],
  ['단위: 배색 · 각도 · WCAG', 'tests/unit/harmony.test.mjs'],
  ...(unitOnly ? [] : [['브라우저: 전체 기능 · 재실행 · 모바일 · 저장소 고장', 'tests/browser/run.mjs']]),
]

const summary = []
for (const [title, file] of suites) {
  console.log(`\n▶ ${title}`)
  const { status } = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' })
  summary.push([title, status === 0])
}

console.log('\n══════ 결과 요약 ══════')
for (const [title, ok] of summary) console.log(`${ok ? '통과' : '실패'}  ${title}`)
const failed = summary.filter(([, ok]) => !ok).length
process.exit(failed ? 1 : 0)
