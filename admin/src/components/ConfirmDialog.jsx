import Modal from './Modal'

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger'
}) {
  const buttonClasses = {
    danger: 'btn-danger',
    primary: 'btn-primary',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white btn',
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-surface-300 mb-6">{message}</p>
      
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn-secondary">
          {cancelText}
        </button>
        <button
          onClick={() => {
            onConfirm()
            onClose()
          }}
          className={buttonClasses[variant]}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  )
}

