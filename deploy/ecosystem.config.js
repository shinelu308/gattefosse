// ===== PM2 进程守护配置（服务器重启后程序自动启动）=====
// 用法：在 /www/wwwroot/gattefosse 目录下执行：pm2 start deploy/ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'gattefosse',
      cwd: '/www/wwwroot/gattefosse/backend',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // 日志
      out_file: '/www/wwwroot/gattefosse/logs/out.log',
      error_file: '/www/wwwroot/gattefosse/logs/error.log',
      // 内存超过 800M 自动重启，防止卡死
      max_memory_restart: '800M',
      // 崩溃后自动重启
      autorestart: true,
      watch: false,
    },
  ],
};
