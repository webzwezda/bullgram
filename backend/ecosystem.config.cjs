module.exports = {
  apps: [
    {
      name: 'bullgram-tg-backend',
      script: './server.js',
      instances: 1,
      autorestart: true,
      watch: false, // В продакшене watch должен быть false
      max_memory_restart: '500M', // Защита от утечек памяти
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // log_date_format убран: его timestamp-префикс ломает JSONL-строки pino
      // (docs/plans/2026-11-05-logging-research.md §5.3). Время — поле "time"
      // внутри JSON. Ротация: pm2-logrotate (10M x 14, gzip) — настроен на сервере.
      error_file: './logs/app.err.jsonl',
      out_file: './logs/app.out.jsonl',
      merge_logs: true,
      kill_timeout: 5000
    }
  ]
};
