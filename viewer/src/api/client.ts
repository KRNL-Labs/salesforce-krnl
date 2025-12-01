import { SessionStatus, ViewerTokenResponse } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || window.location.origin

export async function pollSessionStatus(sessionId: string): Promise<SessionStatus> {
  const response = await fetch(`${API_BASE_URL}/api/access/public-session/${sessionId}`)
  
  if (!response.ok) {
    throw new Error(`Failed to fetch session status: ${response.statusText}`)
  }
  
  return response.json()
}

export async function getViewerToken(sessionId: string): Promise<ViewerTokenResponse> {
  const response = await fetch(`${API_BASE_URL}/api/access/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sessionId })
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message || 'Failed to get viewer token')
  }
  
  return response.json()
}

export async function fetchDocument(token: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/view?token=${token}`)
  
  if (!response.ok) {
    throw new Error(`Failed to fetch document: ${response.statusText}`)
  }
  
  return response.blob()
}
