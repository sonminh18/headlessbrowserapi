export default function StatsCard({ title, value, subtitle, icon, trend, color = 'primary' }) {
  const colorClasses = {
    primary: 'from-primary-500/20 to-primary-600/10 border-primary-500/30',
    emerald: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
    amber: 'from-amber-500/20 to-amber-600/10 border-amber-500/30',
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
    red: 'from-red-500/20 to-red-600/10 border-red-500/30',
  }

  const iconColorClasses = {
    primary: 'text-primary-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
    red: 'text-red-400',
  }

  return (
    <div className={`glass-card p-4 sm:p-6 bg-gradient-to-br ${colorClasses[color]} animate-slide-up`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm text-surface-400 font-medium truncate">{title}</p>
          <p className="text-2xl sm:text-3xl font-bold text-surface-100 mt-1 sm:mt-2 font-mono">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-xs sm:text-sm text-surface-500 mt-1 truncate">{subtitle}</p>
          )}
          {trend && (
            <div className={`flex items-center gap-1 mt-1 sm:mt-2 text-xs sm:text-sm ${
              trend > 0 ? 'text-emerald-400' : trend < 0 ? 'text-red-400' : 'text-surface-400'
            }`}>
              {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
              <span>{Math.abs(trend)}%</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={`p-2 sm:p-3 rounded-lg sm:rounded-xl bg-surface-800/50 shrink-0 ${iconColorClasses[color]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
