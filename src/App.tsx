import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Chat } from './components/Chat';
import { GroupChat } from './components/GroupChat';
import './App.css'

function App() {
  const [view, setView] = useState<'dm' | 'group'>('dm');
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

      <main className="w-full flex flex-col items-center">
        {/* View Toggle */}
        <div className="flex gap-4 mb-6 bg-gray-900 p-1 rounded-lg border border-gray-800">
          <button
            onClick={() => setView('dm')}
            className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${view === 'dm' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
          >
            Direct Messages
          </button>
          <button
            onClick={() => setView('group')}
            className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${view === 'group' ? 'bg-emerald-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
          >
            Group Chat
          </button>
        </div>

        {view === 'dm' ? <Chat /> : <GroupChat />}
      </main>

      <footer className="mt-12 text-gray-500 text-sm">
        Built with XMTP v3 & Wagmi
      </footer>
    </div>
  )
}

export default App
