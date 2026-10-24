interface ToastProps {
  message: string | null
}

/** 화면 아래에 잠깐 떠오르는 알림 메시지 (예: "복사했습니다") */
export function Toast({ message }: ToastProps) {
  return (
    <div className={`toast${message ? ' is-visible' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  )
}
