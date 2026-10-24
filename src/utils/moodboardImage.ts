// 무드보드 참고 이미지를 저장하기 전에 줄이고 압축합니다.
// 원본 사진(수 MB)을 그대로 쌓으면 브라우저 저장 공간이 금방 차기 때문입니다.

import { ImageError, loadImage, validateImageFile } from './extractColors'

/** 저장할 이미지의 최대 가로/세로 크기 (px). 무드보드 표시와 PNG 내보내기에 충분한 크기입니다. */
export const MAX_STORED_SIDE = 1600
const QUALITY = 0.85

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))
}

/**
 * 이미지 파일을 검사하고, 최대 1600px로 줄여 WebP(지원하지 않으면 JPEG)로 압축합니다.
 * 원본이 이미 충분히 작고 가벼우면 원본을 그대로 씁니다.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const invalid = validateImageFile(file)
  if (invalid) throw new ImageError(invalid)

  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, MAX_STORED_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageError('이 브라우저에서는 Canvas를 사용할 수 없습니다.')
    ctx.drawImage(img, 0, 0, width, height)

    let blob = await encode(canvas, 'image/webp')
    // 일부 브라우저는 WebP 인코딩을 지원하지 않아 PNG를 돌려줍니다. 그럴 땐 JPEG로 저장합니다.
    if (!blob || blob.type !== 'image/webp') {
      // JPEG는 투명도를 지원하지 않으므로 흰 배경을 깔고 다시 그립니다.
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, width, height)
      blob = await encode(canvas, 'image/jpeg')
    }
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new ImageError('이미지를 압축하지 못했습니다.')

    if (scale === 1 && file.size <= blob.size) return { blob: file, width, height }
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}
