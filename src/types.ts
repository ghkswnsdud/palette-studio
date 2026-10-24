// 앱 전체에서 함께 쓰는 데이터 "모양(타입)"을 모아 둔 파일입니다.

/** 팔레트에 들어가는 색상 하나 */
export interface PaletteColor {
  id: string
  /** '#RRGGBB' 형식의 대문자 HEX 코드 */
  hex: string
  /** 이미지에서 이 색이 차지하는 비율 (0~1). 직접 추가한 색은 0 */
  ratio: number
}

/** 무드보드 위에 놓이는 요소들의 공통 속성 (위치와 크기) */
interface BoardItemBase {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 참고 이미지. 이미지 데이터 자체는 IndexedDB에 따로 저장하고 id로만 연결합니다. */
export interface BoardImageItem extends BoardItemBase {
  type: 'image'
  imageId: string
}

/** 팔레트 카드 (추가한 시점의 색을 복사해 둡니다) */
export interface BoardPaletteItem extends BoardItemBase {
  type: 'palette'
  name: string
  colors: string[]
}

export interface BoardColorItem extends BoardItemBase {
  type: 'color'
  hex: string
}

export interface BoardNoteItem extends BoardItemBase {
  type: 'note'
  text: string
}

/** 무드보드 요소: 이미지, 팔레트, 색상 칩, 메모 중 하나. 배열 순서가 곧 겹침 순서입니다. */
export type BoardItem = BoardImageItem | BoardPaletteItem | BoardColorItem | BoardNoteItem

/** 무드보드 프로젝트 */
export interface MoodboardProject {
  id: string
  name: string
  items: BoardItem[]
  createdAt: string
  updatedAt: string
}
