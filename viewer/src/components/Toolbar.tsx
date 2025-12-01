import { useEffect, useState } from 'react'

interface ToolbarProps {
  isDarkMode: boolean
  onToggleTheme: () => void
  expiryTime: Date | null
}

export default function Toolbar({ isDarkMode, onToggleTheme, expiryTime }: ToolbarProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>('')

  useEffect(() => {
    if (!expiryTime) return

    const updateTimer = () => {
      const now = new Date()
      const diff = expiryTime.getTime() - now.getTime()
      
      if (diff <= 0) {
        setTimeRemaining('Expired')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m remaining`)
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s remaining`)
      } else {
        setTimeRemaining(`${seconds}s remaining`)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [expiryTime])

  return (
    <div className={`flex items-center justify-between px-6 py-4 border-b ${
      isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
    }`}>
      <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        Secure Document Viewer
      </h1>
      
      <div className="flex items-center gap-4">
        {timeRemaining && (
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {timeRemaining}
          </span>
        )}
        
        <button
          onClick={onToggleTheme}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isDarkMode 
              ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
              : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
          }`}
        >
          {isDarkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
      </div>
    </div>
  )
}
