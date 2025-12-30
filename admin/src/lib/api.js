/**
 * API client for Admin Portal
 */

const API_BASE = '/admin/api'

/**
 * Make an API request
 * @param {string} endpoint - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<any>}
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  }
  
  const response = await fetch(url, config)
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  
  return response.json()
}

// Dashboard
export const getDashboard = () => request('/dashboard')

// Browsers
export const getBrowsers = () => request('/browsers')
export const terminateBrowser = (id) => request(`/browsers/${id}/terminate`, { method: 'POST' })

// URLs
export const getUrls = (params = {}) => {
  const query = new URLSearchParams(params).toString()
  return request(`/urls${query ? `?${query}` : ''}`)
}
export const getUrlDetails = (id) => request(`/urls/${id}`)
export const addUrl = (url) => request('/urls', { method: 'POST', body: JSON.stringify({ url }) })
export const rescrapeUrl = (id) => request(`/urls/${id}/rescrape`, { method: 'POST' })
export const cancelUrl = (id) => request(`/urls/${id}/cancel`, { method: 'POST' })
export const deleteUrl = (id) => request(`/urls/${id}`, { method: 'DELETE' })

// Videos
export const getVideos = (params = {}) => {
  const query = new URLSearchParams(params).toString()
  return request(`/videos${query ? `?${query}` : ''}`)
}
export const addVideo = (data) => request('/videos', { method: 'POST', body: JSON.stringify(data) })
export const updateVideo = (id, data) => request(`/videos/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteVideo = (id) => request(`/videos/${id}`, { method: 'DELETE' })
export const syncVideo = (id) => request(`/videos/${id}/sync`, { method: 'POST' })
export const syncAllVideos = () => request('/videos/sync-all', { method: 'POST' })
export const downloadVideo = (id) => request(`/videos/${id}/download`, { method: 'POST' })

// Storage
export const getStorageStatus = () => request('/storage/status')
export const testStorageConnection = () => request('/storage/test', { method: 'POST' })

// Cache
export const getCacheStats = () => request('/cache/stats')
export const clearCache = (pattern) => request('/cache/clear', { 
  method: 'POST', 
  body: JSON.stringify({ pattern }) 
})

