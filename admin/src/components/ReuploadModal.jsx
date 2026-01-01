import { useState } from 'react'
import Modal from './Modal'

/**
 * Reupload Options Modal
 * Allows configuring reupload behavior before starting
 * @param {object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close callback
 * @param {Function} props.onConfirm - Confirm callback with options
 * @param {object} props.video - Video being re-uploaded (optional, for single reupload)
 * @param {number} props.count - Number of videos (for bulk reupload)
 */
export default function ReuploadModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  video = null, 
  count = 1,
  loading = false 
}) {
  const [options, setOptions] = useState({
    force: false,           // Skip S3 existence check
    deleteFirst: true,      // Delete existing S3 file first
    priority: 0,            // Queue priority (0 = normal)
    highPriority: false     // Shortcut for priority: 10
  })

  const handleConfirm = () => {
    onConfirm({
      force: options.force,
      deleteFirst: options.deleteFirst,
      priority: options.highPriority ? 10 : options.priority
    })
  }

  const isBulk = count > 1

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isBulk ? `Re-upload ${count} Videos` : 'Re-upload Options'}
    >
      <div className="space-y-4">
        {/* Description */}
        <p className="text-surface-400 text-sm">
          {isBulk 
            ? `Configure options for re-uploading ${count} selected videos.`
            : 'Configure re-upload behavior for this video.'
          }
        </p>

        {/* Video info (single reupload) */}
        {video && (
          <div className="glass-card p-3">
            <p className="text-xs text-surface-500 uppercase tracking-wide mb-1">Video URL</p>
            <p className="text-sm text-surface-200 break-all">{video.videoUrl}</p>
            {video.s3Url && (
              <>
                <p className="text-xs text-surface-500 uppercase tracking-wide mt-2 mb-1">Current S3 URL</p>
                <p className="text-sm text-emerald-400 break-all">{video.s3Url}</p>
              </>
            )}
          </div>
        )}

        {/* Options */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-surface-200">Re-upload Options</h4>
          
          {/* Force reupload */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={options.force}
              onChange={(e) => setOptions({ ...options, force: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-surface-600 text-primary-600 focus:ring-primary-500 bg-surface-700"
            />
            <div>
              <span className="text-sm text-surface-200">Force re-upload</span>
              <p className="text-xs text-surface-500">
                Ignore S3 existence check and always upload, even if file exists
              </p>
            </div>
          </label>

          {/* Delete existing first */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={options.deleteFirst}
              onChange={(e) => setOptions({ ...options, deleteFirst: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-surface-600 text-primary-600 focus:ring-primary-500 bg-surface-700"
            />
            <div>
              <span className="text-sm text-surface-200">Delete existing S3 file first</span>
              <p className="text-xs text-surface-500">
                Remove the current S3 file before uploading a new version
              </p>
            </div>
          </label>

          {/* High priority */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={options.highPriority}
              onChange={(e) => setOptions({ ...options, highPriority: e.target.checked, priority: e.target.checked ? 10 : 0 })}
              className="mt-0.5 w-4 h-4 rounded border-surface-600 text-primary-600 focus:ring-primary-500 bg-surface-700"
            />
            <div>
              <span className="text-sm text-surface-200">High priority</span>
              <p className="text-xs text-surface-500">
                Add to front of upload queue (process before other pending uploads)
              </p>
            </div>
          </label>
        </div>

        {/* Warning */}
        {options.force && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-amber-400 text-sm">
              <strong>Note:</strong> Force re-upload will bypass deduplication checks. 
              This may result in duplicate files in S3 if the same video is already stored 
              with a different key.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="btn-secondary w-full sm:w-auto"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="btn-primary w-full sm:w-auto"
          >
            {loading ? 'Processing...' : isBulk ? `Re-upload ${count} Videos` : 'Start Re-upload'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

