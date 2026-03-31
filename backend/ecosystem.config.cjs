module.exports = {
  apps: [
    {
      name: 'bullrun-tg-backend',
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
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true
    }
  ]
};
