export interface SessionStatus {
  sessionId: string
  state: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_EVENT' | 'FAILED'
  accessHash?: string
  txHash?: string
  blockNumber?: number
  error?: string
}

export interface ViewerTokenResponse {
  token: string
  expiresAt?: string
  sessionId: string
}
