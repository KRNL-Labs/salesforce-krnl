interface LoadingStateProps {
  message?: string
  isDarkMode: boolean
}

export default function LoadingState({ message = 'Loading...', isDarkMode }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="relative">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
        <div className="absolute inset-0 rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-300 animate-ping"></div>
      </div>
      <p className={`mt-6 text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {message}
      </p>
    </div>
  )
}
