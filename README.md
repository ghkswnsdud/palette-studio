# Palette Studio

이미지에서 주요 색상을 추출하고, 팔레트를 편집·저장하며, 배색 분석과 무드보드 제작까지 할 수 있는 웹 앱입니다.
모든 처리는 브라우저 안에서 이루어지며 **이미지와 데이터는 어떤 서버로도 전송되지 않습니다.**

## 주요 기능

- **색상 추출**: JPG·PNG·WebP 업로드(클릭/드래그), 5·6·8·10색 추출, HEX·RGB·픽셀 비율 표시, 클릭 복사
- **팔레트 편집**: 색 추가·삭제·순서 변경, HEX/RGB/HSL 편집(실시간 검증), 이름 지정
- **저장**: 팔레트 저장·불러오기·삭제(LocalStorage), JSON 내보내기·가져오기, PNG 이미지 내보내기
- **배색 분석**: OKLCH 기반 유사색·보색·분할 보색·삼색 추천, 명도·채도 비교, WCAG 대비표
- **무드보드**: 프로젝트 관리, 참고 이미지·팔레트·메모 배치(IndexedDB 자동 저장), PNG 내보내기

## 명령어

| 목적 | 명령어 |
|---|---|
| 의존성 설치 (처음 한 번) | `npm install` |
| 개발 서버 실행 | `npm run dev` → 터미널에 표시된 주소(보통 http://localhost:5173) 열기 |
| 배포용 빌드 | `npm run build` → `dist/` 폴더 생성 |
| 빌드 결과 미리보기 | `npm run preview` |
| 타입 검사 (strict 포함) | `npm run typecheck` |
| 코드 규칙 검사 | `npm run lint` |
| 전체 테스트 | `npm test` (단위 + 실제 Chrome 브라우저 테스트) |
| 단위 테스트만 | `npm run test:unit` (Chrome 불필요) |
| 브라우저 테스트만 | `npm run test:browser` |

브라우저 테스트는 설치된 Chrome 또는 Edge를 화면 없이(headless) 실행합니다.
브라우저를 찾지 못하면 `CHROME_PATH` 환경 변수로 실행 파일 경로를 지정하세요.

## 데이터 저장 위치

| 데이터 | 저장소 | 이유 |
|---|---|---|
| 팔레트 | LocalStorage | 작고 단순한 JSON 데이터 |
| 무드보드 프로젝트·참고 이미지 | IndexedDB | 이미지(Blob)를 그대로 저장, 큰 용량, 화면을 멈추지 않는 비동기 처리 |

참고 이미지는 긴 변 1600px 이하로 줄여 WebP로 압축해 저장하며, 프로젝트당 최대 40장입니다.
데이터는 이 브라우저에만 저장되므로, 브라우저 데이터를 지우면 함께 삭제됩니다. 중요한 팔레트는 JSON으로 내보내 보관하세요.

## 폴더 구조

```
src/
├─ components/   화면 컴포넌트 (업로드, 팔레트, 편집, 저장 목록, 배색 분석, 무드보드)
├─ hooks/        무드보드 상태·자동 저장 (useMoodboard)
├─ utils/        색상 변환, 추출, 배색, 저장소, 내보내기
└─ types.ts      공통 데이터 형식
tests/
├─ unit/         Node에서 실행하는 계산·저장 로직 테스트
├─ browser/      실제 Chrome에서 실행하는 전체 기능 테스트
└─ run-all.mjs   전체 테스트 실행기
```

---

## 개발 템플릿 참고 (React + TypeScript + Vite)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
