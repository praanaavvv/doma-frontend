import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Chat } from './components/Chat';
import './App.css'

function App() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-white p-4">
      <header className="flex justify-between items-center w-full max-w-2xl mb-8 p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-xl">
        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          Doma Chat (XMTP v3)
        </h1>
        <div className="flex gap-4">
          {/* Dynamic import probably not needed, but ensuring ConnectButton is used */}
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
      </header>

      <main className="w-full flex justify-center">
        <Chat />
      </main>

      <footer className="mt-12 text-gray-500 text-sm">
        Built with XMTP v3 & Wagmi
      </footer>
    </div>
  )
}

export default App
