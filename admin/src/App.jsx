import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import BrowserManager from './pages/BrowserManager'
import URLs from './pages/URLs'
import VideosManager from './pages/VideosManager'
import Logs from './pages/Logs'

function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="browsers" element={<BrowserManager />} />
          <Route path="urls" element={<URLs />} />
          <Route path="videos" element={<VideosManager />} />
          <Route path="logs" element={<Logs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App

