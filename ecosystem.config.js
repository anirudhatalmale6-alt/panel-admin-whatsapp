// Konfigurasi PM2. Jalankan dari folder aplikasi:
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'wa-admin',
      script: 'src/server.js',
      instances: 1,          // JANGAN dinaikkan: satu sesi WhatsApp hanya boleh
      exec_mode: 'fork',     // dipegang satu proses.
      autorestart: true,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      time: true,
    },
  ],
};
